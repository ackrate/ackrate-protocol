/** One-command reference consumer + fulfillment flow. Every successful source
 * follows HTTP 402 -> MandateRegistry execute_payment -> bound proof -> HTTP 200. */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ackrate, toStroops } from "@ackrate/core";
import {
  TESTNET,
  keypairSigner,
  mainnetNetworkFromDeploymentManifest,
  registryClient,
  token,
  type NetworkConfig,
  type StellarSigner,
} from "@ackrate/stellar";
import { resolveBoundAckrateInterruptedDelivery } from "@ackrate/express-middleware";
import { Keypair, Networks, StrKey, rpc } from "@stellar/stellar-sdk";
import { buyResearch } from "../../../../apps/consumer-agent/src/research-agent.js";
import { FilePurchaseOutcomeStore } from "../../../../apps/consumer-agent/src/outcome-store.js";
import { FileSettlementReceiptStore } from "../../../../apps/consumer-agent/src/receipt-store.js";
import { FileBoundRedemptionStore } from "../../../../apps/fulfillment-agent/src/redemption-store.js";
import { startServer } from "../../../../apps/fulfillment-agent/src/server.js";
import { ackrateHome } from "../secrets.js";
import { assertNoPendingSettlement } from "../settlement-store.js";
import { stellarCliSigner } from "../stellar-cli-signer.js";
import { banner, c, link, log } from "../ui.js";

const SOURCE_IDS = ["market", "academic", "news", "patents"] as const;
const SOURCE_PRICE = "1.00";
const BUDGET = "3.00";
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export interface DemoOptions {
  network?: "testnet" | "mainnet" | string;
  manifest?: string;
  userSigner?: string;
  agentSigner?: string;
  agentSecretEnv?: string;
  merchant?: string;
  budget?: string;
  price?: string;
  confirmRealUsdc?: boolean;
}

type DemoRuntime = Readonly<{
  network: "testnet" | "mainnet";
  net: NetworkConfig;
  userSigner: StellarSigner;
  agentSigner: StellarSigner;
  merchant: string;
  asset: string;
  symbol: "XLM" | "USDC";
  budget: string;
  price: string;
  decimals: number;
}>;

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const explorerTx = (network: "testnet" | "mainnet", hash: string) =>
  `https://stellar.expert/explorer/${network === "mainnet" ? "public" : "testnet"}/tx/${hash}`;

function amountText(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function fund(pub: string): Promise<void> {
  const server = new rpc.Server(TESTNET.rpcUrl);
  for (let round = 0; round < 4; round += 1) {
    await fetch(`https://friendbot.stellar.org/?addr=${pub}`).catch(() => undefined);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await server.getAccount(pub);
        return;
      } catch {
        await sleep(1_000);
      }
    }
  }
  throw new Error(`friendbot could not fund ${pub} after several attempts`);
}

async function waitForSeq(
  client: ReturnType<typeof registryClient>,
  mandateId: Buffer,
  target: number,
): Promise<Awaited<ReturnType<ReturnType<typeof registryClient>["get_mandate"]>>> {
  let last: Awaited<ReturnType<ReturnType<typeof registryClient>["get_mandate"]>> | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await client.get_mandate({ mandate_id: mandateId });
    if (Number(last.result.unwrap().seq) >= target) return last;
    await sleep(1_000);
  }
  throw new Error(`mandate sequence did not reach ${target}; last read was ${last ? "available" : "unavailable"}`);
}

async function testnetRuntime(): Promise<DemoRuntime> {
  const user = Keypair.random();
  const agent = Keypair.random();
  const merchant = Keypair.random();
  log.step("funding three ephemeral testnet accounts via Friendbot");
  await Promise.all([fund(user.publicKey()), fund(agent.publicKey()), fund(merchant.publicKey())]);
  return Object.freeze({
    network: "testnet",
    net: TESTNET,
    userSigner: keypairSigner(user, TESTNET.networkPassphrase),
    agentSigner: keypairSigner(agent, TESTNET.networkPassphrase),
    merchant: merchant.publicKey(),
    asset: TESTNET.nativeSac,
    symbol: "XLM",
    budget: BUDGET,
    price: SOURCE_PRICE,
    decimals: 7,
  });
}

function required(value: string | undefined, flag: string): string {
  const text = value?.trim();
  if (!text) throw new Error(`mainnet demo requires ${flag}`);
  return text;
}

export function secretManagerAgentSigner(
  envName: string,
  expectedPublicKey: string,
  net: NetworkConfig,
): StellarSigner {
  if (!ENV_NAME.test(envName)) throw new Error("agent secret environment-variable name is invalid");
  const secret = process.env[envName];
  if (!secret) {
    throw new Error(`secret manager did not supply the agent key in ${envName}; bound-v2 refuses transaction-only signers`);
  }
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch {
    throw new Error(`${envName} does not contain a valid Stellar secret key`);
  }
  if (keypair.publicKey() !== expectedPublicKey) {
    throw new Error(`${envName} does not match the configured agent identity`);
  }
  return keypairSigner(keypair, net.networkPassphrase);
}

async function mainnetRuntime(options: DemoOptions): Promise<DemoRuntime> {
  if (!options.confirmRealUsdc) {
    throw new Error("mainnet demo requires --confirm-real-usdc before reading configuration or opening a signer");
  }
  const manifestPath = required(options.manifest, "--manifest <path>");
  const net = mainnetNetworkFromDeploymentManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
  );
  const merchant = required(options.merchant, "--merchant <G...>");
  if (!StrKey.isValidEd25519PublicKey(merchant)) throw new Error("--merchant must be a Stellar G-account");
  const budget = required(options.budget, "--budget <usdc>");
  const price = required(options.price, "--price <usdc>");
  const budgetUnits = toStroops(budget, net.settlementAsset.decimals);
  const priceUnits = toStroops(price, net.settlementAsset.decimals);
  if (priceUnits <= 0n || budgetUnits < priceUnits * 3n || budgetUnits >= priceUnits * 4n) {
    throw new Error("mainnet demo budget must cover exactly three prices and reject the fourth");
  }

  const [userSigner, expectedAgentSigner] = await Promise.all([
    stellarCliSigner(required(options.userSigner, "--user-signer <identity>"), net),
    stellarCliSigner(required(options.agentSigner, "--agent-signer <identity>"), net),
  ]);
  const secretEnv = required(options.agentSecretEnv, "--agent-secret-env <NAME>");
  const boundAgentSigner = secretManagerAgentSigner(secretEnv, expectedAgentSigner.publicKey, net);
  if (new Set([userSigner.publicKey, boundAgentSigner.publicKey, merchant]).size !== 3) {
    throw new Error("mainnet user, agent, and merchant accounts must be distinct");
  }

  const server = new rpc.Server(net.rpcUrl);
  const identity = await server.getNetwork();
  if (identity.passphrase !== Networks.PUBLIC) throw new Error("mainnet RPC identity mismatch");
  await Promise.all([
    server.getAccount(userSigner.publicKey),
    server.getAccount(boundAgentSigner.publicKey),
    server.getAccount(merchant),
  ]);
  const [chainDecimals, userUsdc, userXlm, agentXlm] = await Promise.all([
    token.decimals(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.nativeSac, userSigner.publicKey),
    token.balance(net, net.nativeSac, boundAgentSigner.publicKey),
  ]);
  if (chainDecimals !== net.settlementAsset.decimals) throw new Error("manifest and chain USDC decimals differ");
  if (userUsdc < budgetUnits) throw new Error("mainnet user USDC balance is below the requested budget");
  const feeReserve = toStroops("0.50", 7);
  if (userXlm < feeReserve || agentXlm < feeReserve) {
    throw new Error("mainnet user and agent must each retain at least 0.50 XLM");
  }
  if ((await registryClient(net, expectedAgentSigner).is_paused()).result) {
    throw new Error("mainnet MandateRegistry is paused");
  }
  return Object.freeze({
    network: "mainnet",
    net,
    userSigner,
    agentSigner: boundAgentSigner,
    merchant,
    asset: net.settlementAsset.contractId,
    symbol: "USDC",
    budget,
    price,
    decimals: chainDecimals,
  });
}

function stableChallengeSecret(): string {
  const directory = join(ackrateHome(), "research-agent-demo");
  const path = join(directory, "challenge-secret");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  try {
    const info = statSync(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("demo challenge secret is not private");
    const existing = readFileSync(path, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(existing)) throw new Error("demo challenge secret is malformed");
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const created = randomBytes(32).toString("hex");
  writeFileSync(path, `${created}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return created;
}

async function closeServer(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function executeDemo(runtime: DemoRuntime): Promise<void> {
  const merchantBefore = await token.balance(runtime.net, runtime.asset, runtime.merchant);
  const mandate = ackrate.createIntentMandate({
    user: runtime.userSigner.publicKey,
    agent: runtime.agentSigner.publicKey,
    merchant: runtime.merchant,
    asset: runtime.asset,
    maxAmount: runtime.budget,
    expiry: Math.floor(Date.now() / 1_000) + 3_600,
    decimals: runtime.decimals,
    nonce: `${Date.now()}:${randomBytes(12).toString("hex")}`,
  }, runtime.net);
  const registerTx = await ackrate.registerMandate(mandate, { signer: runtime.userSigner }, runtime.net);
  const approveTx = await ackrate.approveBudget(mandate, { signer: runtime.userSigner }, runtime.net);
  log.chain("mandate and contract allowance confirmed", {
    register: link(explorerTx(runtime.network, registerTx), short(registerTx)),
    allowance: link(explorerTx(runtime.network, approveTx), short(approveTx)),
  });

  const stateRoot = join(ackrateHome(), "research-agent-demo", mandate.id);
  const receiptStore = new FileSettlementReceiptStore(join(stateRoot, "receipts.json"));
  const outcomeStore = new FilePurchaseOutcomeStore(join(stateRoot, "outcomes.json"));
  const redemptionStore = new FileBoundRedemptionStore(join(stateRoot, "redemptions.json"));
  for (const record of await redemptionStore.listExecuting()) {
    await resolveBoundAckrateInterruptedDelivery({ redemptionStore, record });
  }
  const fulfillment = await startServer({
    port: 0,
    merchant: runtime.merchant,
    sourceAccount: runtime.merchant,
    challengeSecret: stableChallengeSecret(),
    redemptionStore,
    networkConfig: runtime.net,
    asset: runtime.asset,
    network: runtime.network === "mainnet" ? "stellar-mainnet" : "stellar-testnet",
    amount: runtime.price,
  });

  let results;
  try {
    results = await buyResearch({
      serverUrl: fulfillment.url,
      sourceIds: [...SOURCE_IDS],
      mandate,
      agentSigner: runtime.agentSigner,
      networkConfig: runtime.net,
      receiptStore,
      outcomeStore,
      onEvent: (event) => {
        if (event.type === "buying") log.step(`requesting ${event.id} through the fulfillment agent`);
        if (event.type === "paid" && event.txHash) {
          log.ok(`${event.id} delivered after verified payment`, {
            tx: link(explorerTx(runtime.network, event.txHash), short(event.txHash)),
          });
        }
        if (event.type === "blocked") log.warn(`${event.id} blocked`, { reason: event.reason ?? "contract rejection" });
        if (event.type === "delivery-pending") log.err(`${event.id} requires exact-receipt recovery`, { reason: event.reason ?? "pending" });
      },
    });
  } finally {
    await closeServer(fulfillment.server);
  }

  const delivered = results.slice(0, 3);
  const blocked = results[3];
  const hashes = delivered.map((result) => result.txHash);
  if (
    delivered.some((result) => !result.ok || result.deliveryState !== "delivered" || !result.txHash || !result.receipt)
    || !blocked
    || blocked.ok
    || blocked.deliveryState !== "rejected"
    || blocked.blockedReason !== "budget exceeded"
    || blocked.txHash !== undefined
    || new Set(hashes).size !== 3
  ) throw new Error("reference-agent delivery evidence did not match three deliveries and one no-payment budget rejection");

  const finalRead = await waitForSeq(registryClient(runtime.net, runtime.agentSigner), mandate.idBuffer, 3);
  const finalMandate = finalRead.result.unwrap();
  const merchantAfter = await token.balance(runtime.net, runtime.asset, runtime.merchant);
  const expected = toStroops(runtime.price, runtime.decimals) * 3n;
  const transferred = merchantAfter - merchantBefore;
  if (Number(finalMandate.seq) !== 3 || finalMandate.spent !== expected || transferred !== expected) {
    throw new Error("contract state, merchant delta, and delivered receipts disagree");
  }

  console.log(
    `\n${c.bold("Verified result")}\n`
    + `${c.gray("  flow       ")}${c.white("HTTP 402 → execute_payment → bound proof → HTTP 200")}\n`
    + `${c.gray("  delivered  ")}${c.white("3 protected research sources")}\n`
    + `${c.gray("  transferred")}${c.white(` ${amountText(transferred, runtime.decimals)} ${runtime.symbol}`)}\n`
    + `${c.gray("  protected  ")}${c.white("purchase four rejected by the contract with no fourth payment")}\n`,
  );
}

const DEMOS = [{ id: "research-agent", summary: "Reference consumer and fulfillment agents complete protected purchases through Ackrate." }];

function listDemos(): void {
  console.log(`\n${banner()}\n`);
  for (const demo of DEMOS) log.step(demo.id, { run: `ackrate demo ${demo.id} --network testnet` });
}

export async function runDemo(target?: string, options: DemoOptions = {}): Promise<void> {
  if (!target) return listDemos();
  if (!DEMOS.some((demo) => demo.id === target)) throw new Error(`unknown demo ${JSON.stringify(target)}`);
  await assertNoPendingSettlement();
  if (options.network !== undefined && options.network !== "testnet" && options.network !== "mainnet") {
    throw new Error("--network must be testnet or mainnet");
  }
  const network = options.network ?? "testnet";
  console.log(`\n${banner(network === "mainnet" ? "stellar mainnet · real USDC" : "stellar testnet · XLM")}\n`);
  await executeDemo(network === "mainnet" ? await mainnetRuntime(options) : await testnetRuntime());
}
