/**
 * `ackrate demo research-agent` — the "aha" walkthrough.
 *
 * Self-contained and runs cold: spins up three ephemeral testnet accounts,
 * registers a real on-chain mandate, then has the agent buy research sources one
 * by one — each a real `execute_payment`. The mandate budget covers three; the
 * contract rejects the fourth. The point is the on-chain enforcement, so there's
 * no LLM dependency: the payments are real, the "research" framing is scripted.
 *
 * Reliability: instead of arbitrary sleeps, we poll for the state we just wrote
 * (account funded, mandate seq advanced) so a slow testnet doesn't cause a stale
 * read (the C2 BadSequence race). The contract is the source of truth throughout.
 */
import { readFileSync } from "node:fs";
import { SettlementUncertainError, ackrate, toStroops, type Agent } from "@ackrate/core";
import {
  TESTNET,
  mainnetNetworkFromDeploymentManifest,
  registryClient,
  keypairSigner,
  token,
  type NetworkConfig,
  type StellarSigner,
} from "@ackrate/stellar";
import { Keypair, Networks, StrKey, rpc } from "@stellar/stellar-sdk";
import { log, c, banner, link } from "../ui.js";
import { stellarCliSigner } from "../stellar-cli-signer.js";
import {
  acknowledgeCompletedSettlement,
  assertNoPendingSettlement,
  claimPendingSettlement,
  clearPendingSettlement,
  markSettlementCompleted,
} from "../settlement-store.js";
import { isFinalPaymentRejection } from "../payment-failure.js";

const SOURCES = [
  { name: "Market Data API", icon: "📈" },
  { name: "Academic Papers", icon: "📚" },
  { name: "News Archive", icon: "📰" },
  { name: "Patent Database", icon: "⚗️" },
  { name: "Analyst Reports", icon: "🏦" },
];
const SOURCE_PRICE = "1.00";
const BUDGET = "3.00"; // three sources fit; the contract blocks the fourth

export interface DemoOptions {
  network?: "testnet" | "mainnet" | string;
  manifest?: string;
  userSigner?: string;
  agentSigner?: string;
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

const short = (s: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fund an account and confirm it on the soroban RPC (the same source the
 *  contract calls use). Friendbot can rate-limit or drop a request, so retry the
 *  friendbot hit if the account hasn't appeared, and throw loudly if it never
 *  does rather than letting a later call fail with a confusing "not found". */
async function fund(pub: string): Promise<void> {
  const server = new rpc.Server(TESTNET.rpcUrl);
  for (let round = 0; round < 4; round += 1) {
    await fetch(`https://friendbot.stellar.org/?addr=${pub}`).catch(() => undefined);
    for (let i = 0; i < 8; i += 1) {
      try {
        await server.getAccount(pub);
        return;
      } catch {
        // not visible on the RPC yet — keep polling before re-friendbotting
      }
      await sleep(1000);
    }
  }
  throw new Error(`friendbot could not fund ${pub} after several attempts`);
}

/** Poll the contract until the mandate's seq reaches `target` (write propagated). */
async function waitForSeq(
  client: ReturnType<typeof registryClient>,
  idBuffer: Buffer,
  target: number,
  tries = 20,
): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const md = (await client.get_mandate({ mandate_id: idBuffer })).result.unwrap();
      if (Number(md.seq) >= target) return;
    } catch {
      // transient read error — keep polling
    }
    await sleep(1000);
  }
  throw new Error(`mandate sequence did not reach ${target} before the RPC read deadline`);
}

type Attempt = { kind: "ok"; hash: string } | { kind: "blocked" } | { kind: "retry" } | { kind: "error"; msg: string } | { kind: "uncertain"; msg: string };

async function attemptPurchase(
  agent: Agent,
  runtime: Pick<DemoRuntime, "network" | "net" | "price">,
): Promise<Attempt> {
  let preparedHash: string | undefined;
  try {
    const hash = await agent.pay(runtime.price, {
      onPrepared: async (pending) => {
        await claimPendingSettlement("demo", runtime.net.mandateRegistryId, pending, {
          network: runtime.network,
          rpcUrl: runtime.net.rpcUrl,
        });
        preparedHash = pending.txHash;
      },
    });
    await markSettlementCompleted(hash);
    return { kind: "ok", hash };
  } catch (e) {
    if (e instanceof SettlementUncertainError) {
      return {
        kind: "uncertain",
        msg: `transaction ${e.settlement.txHash} is unresolved; run ackrate settlement reconcile`,
      };
    }
    if (isFinalPaymentRejection(e) && preparedHash) {
      try {
        await clearPendingSettlement(preparedHash);
      } catch (clearError) {
        return {
          kind: "uncertain",
          msg: `journal clear failed: ${clearError instanceof Error ? clearError.message : String(clearError)}`,
        };
      }
    }
    if (preparedHash && !isFinalPaymentRejection(e)) {
      return {
        kind: "uncertain",
        msg: `transaction ${preparedHash} has an unknown post-prepare result; run ackrate settlement reconcile`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const code = (msg.match(/Error\(Contract,\s*#(\d+)\)/) ?? [])[1];
    if (code === "6") return { kind: "blocked" }; // BudgetExceeded — the aha
    if (code === "8") return { kind: "retry" }; // BadSequence — stale read, wait & retry
    return { kind: "error", msg: (msg.split("\n")[0] ?? msg).slice(0, 90) };
  }
}

const DEMOS: { id: string; summary: string }[] = [
  {
    id: "research-agent",
    summary:
      "An agent buys research sources on-chain; testnet uses XLM, while explicit manifest-gated mainnet mode uses real USDC.",
  },
];

/** Print the available demos and how to run each. */
function listDemos(): void {
  console.log("\n" + banner() + "\n");
  log.info("available demos");
  for (const d of DEMOS) {
    log.step(d.id, { run: `ackrate demo ${d.id} --network testnet` });
    console.log("  " + c.gray(d.summary));
  }
  console.log();
}

const explorerTx = (network: "testnet" | "mainnet", hash: string) =>
  `https://stellar.expert/explorer/${network === "mainnet" ? "public" : "testnet"}/tx/${hash}`;

function amountText(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function testnetRuntime(): Promise<DemoRuntime> {
  const user = Keypair.random();
  const agent = Keypair.random();
  const merchant = Keypair.random();
  log.step("funding 3 ephemeral testnet accounts via friendbot");
  await Promise.all([fund(user.publicKey()), fund(agent.publicKey()), fund(merchant.publicKey())]);
  log.chain("accounts funded", {
    user: short(user.publicKey()),
    agent: short(agent.publicKey()),
    merchant: short(merchant.publicKey()),
  });
  return Object.freeze({
    network: "testnet" as const,
    net: TESTNET,
    userSigner: keypairSigner(user, TESTNET.networkPassphrase),
    agentSigner: keypairSigner(agent, TESTNET.networkPassphrase),
    merchant: merchant.publicKey(),
    asset: TESTNET.nativeSac,
    symbol: "XLM" as const,
    budget: BUDGET,
    price: SOURCE_PRICE,
    decimals: 7,
  });
}

function requireMainnetText(value: string | undefined, flag: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`mainnet demo requires ${flag}`);
  return normalized;
}

async function mainnetRuntime(options: DemoOptions): Promise<DemoRuntime> {
  if (!options.confirmRealUsdc) {
    throw new Error("mainnet demo requires --confirm-real-usdc to acknowledge an irreversible real-USDC payment");
  }
  const manifestPath = requireMainnetText(options.manifest, "--manifest <path>");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`could not read the mainnet deployment manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  const net = mainnetNetworkFromDeploymentManifest(manifest);
  const merchant = requireMainnetText(options.merchant, "--merchant <G...>");
  if (!StrKey.isValidEd25519PublicKey(merchant)) {
    throw new Error("--merchant must be a Stellar G-account");
  }
  const budget = requireMainnetText(options.budget, "--budget <usdc>");
  const price = requireMainnetText(options.price, "--price <usdc>");
  const budgetUnits = toStroops(budget, net.settlementAsset.decimals);
  const priceUnits = toStroops(price, net.settlementAsset.decimals);
  if (priceUnits <= 0n || budgetUnits < priceUnits * 3n || budgetUnits >= priceUnits * 4n) {
    throw new Error("mainnet demo budget must cover exactly three prices and reject the fourth");
  }

  const [userSigner, agentSigner] = await Promise.all([
    stellarCliSigner(requireMainnetText(options.userSigner, "--user-signer <stellar-identity>"), net),
    stellarCliSigner(requireMainnetText(options.agentSigner, "--agent-signer <stellar-identity>"), net),
  ]);
  if (new Set([userSigner.publicKey, agentSigner.publicKey, merchant]).size !== 3) {
    throw new Error("mainnet user, agent, and merchant accounts must be distinct");
  }

  const server = new rpc.Server(net.rpcUrl);
  const identity = await server.getNetwork();
  if (identity.passphrase !== Networks.PUBLIC || net.networkPassphrase !== Networks.PUBLIC) {
    throw new Error("mainnet RPC identity does not match the public Stellar network");
  }
  await Promise.all([
    server.getAccount(userSigner.publicKey),
    server.getAccount(agentSigner.publicKey),
    server.getAccount(merchant),
  ]);
  const [chainDecimals, userUsdc, userXlm, agentXlm] = await Promise.all([
    token.decimals(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.nativeSac, userSigner.publicKey),
    token.balance(net, net.nativeSac, agentSigner.publicKey),
  ]);
  if (chainDecimals !== net.settlementAsset.decimals) {
    throw new Error(`USDC decimals conflict: manifest=${net.settlementAsset.decimals}, chain=${chainDecimals}`);
  }
  if (userUsdc < budgetUnits) {
    throw new Error(`user USDC balance ${amountText(userUsdc, chainDecimals)} is below budget ${budget}`);
  }
  const feeReserve = toStroops("0.50", 7);
  if (userXlm < feeReserve || agentXlm < feeReserve) {
    throw new Error("mainnet user and agent must each retain at least 0.50 XLM for fees and reserve headroom");
  }
  const reader = registryClient(net, agentSigner);
  if ((await reader.is_paused()).result) {
    throw new Error("mainnet MandateRegistry is paused");
  }

  log.warn("real-value mode confirmed", {
    network: "Stellar mainnet",
    asset: "USDC",
    budget,
    price,
  });
  log.chain("mainnet preflight passed", {
    contract: short(net.mandateRegistryId),
    user: short(userSigner.publicKey),
    agent: short(agentSigner.publicKey),
    merchant: short(merchant),
  });
  return Object.freeze({
    network: "mainnet" as const,
    net,
    userSigner,
    agentSigner,
    merchant,
    asset: net.settlementAsset.contractId,
    symbol: "USDC" as const,
    budget,
    price,
    decimals: chainDecimals,
  });
}

async function executeDemo(runtime: DemoRuntime): Promise<void> {
  const merchantBefore = await token.balance(runtime.net, runtime.asset, runtime.merchant);
  const inputs = {
    user: runtime.userSigner.publicKey,
    agent: runtime.agentSigner.publicKey,
    merchant: runtime.merchant,
    asset: runtime.asset,
    maxAmount: runtime.budget,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    decimals: runtime.decimals,
    nonce: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
  };
  const mandate = ackrate.createIntentMandate(inputs, runtime.net);
  const registerTx = await ackrate.registerMandate(mandate, { signer: runtime.userSigner }, runtime.net);
  const approveTx = await ackrate.approveBudget(mandate, { signer: runtime.userSigner }, runtime.net);
  log.chain("mandate registered + allowance approved for contract", {
    budget: `${runtime.budget} ${runtime.symbol}`,
    id: short(mandate.id),
    register: short(registerTx),
    approve: short(approveTx),
  });

  const rclient = registryClient(runtime.net, runtime.agentSigner);
  const paymentAgent = ackrate.agent({ mandate, signer: runtime.agentSigner }, runtime.net);
  let purchased = 0;
  let seq = 0;
  let budgetBlocked = false;
  outer: for (const source of SOURCES) {
    log.step(`agent buys ${source.icon} ${source.name}`, { price: `${runtime.price} ${runtime.symbol}` });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await attemptPurchase(paymentAgent, runtime);
      if (result.kind === "ok") {
        seq += 1;
        await waitForSeq(rclient, mandate.idBuffer, seq);
        purchased += 1;
        log.ok("purchased on-chain", {
          tx: link(explorerTx(runtime.network, result.hash), short(result.hash)),
        });
        await acknowledgeCompletedSettlement(result.hash);
        break;
      }
      if (result.kind === "blocked") {
        budgetBlocked = true;
        log.warn(`contract blocked the purchase — ${runtime.budget} ${runtime.symbol} budget exhausted`);
        break outer;
      }
      if (result.kind === "retry") {
        await waitForSeq(rclient, mandate.idBuffer, seq);
        continue;
      }
      if (result.kind === "uncertain") {
        throw new Error(`${result.msg}. Do not restart the demo until reconciliation completes.`);
      }
      throw new Error(`purchase failed: ${result.msg}`);
    }
  }

  const finalMandate = (await rclient.get_mandate({ mandate_id: mandate.idBuffer })).result.unwrap();
  const merchantAfter = await token.balance(runtime.net, runtime.asset, runtime.merchant);
  const transferred = merchantAfter - merchantBefore;
  const expected = toStroops(runtime.price, runtime.decimals) * 3n;
  const passed = purchased === 3
    && budgetBlocked
    && finalMandate.spent === expected
    && Number(finalMandate.seq) === 3
    && transferred === expected;

  console.log(
    "\n" + c.bold("Result") + "\n"
    + c.gray("  network    ") + c.white(runtime.network === "mainnet" ? "Stellar mainnet" : "Stellar testnet") + "\n"
    + c.gray("  purchased  ") + c.white(`${purchased} sources`) + c.gray(" for ")
      + c.white(`${amountText(expected, runtime.decimals)} ${runtime.symbol}`) + c.gray(" settled on-chain") + "\n"
    + c.gray("  enforced   ") + c.white(`${runtime.budget} ${runtime.symbol}`)
      + c.gray(` budget cap — ${budgetBlocked ? "the contract rejected purchase four" : "expected rejection was not observed"}`) + "\n"
    + c.gray("  verified   ") + c.white(`${Number(finalMandate.seq)} payments`)
      + c.gray(` · ${amountText(transferred, runtime.decimals)} ${runtime.symbol} merchant delta`) + "\n",
  );
  if (!passed) {
    throw new Error(
      `demo evidence mismatch: purchased=${purchased}, blocked=${budgetBlocked}, seq=${Number(finalMandate.seq)}, spent=${finalMandate.spent}, transferred=${transferred}`,
    );
  }
}

export async function runDemo(target?: string, options: DemoOptions = {}): Promise<void> {
  if (!target) {
    listDemos();
    return;
  }
  if (!DEMOS.some((d) => d.id === target)) {
    log.warn(`unknown demo "${target}"`);
    listDemos();
    process.exitCode = 1;
    return;
  }

  try {
    await assertNoPendingSettlement();
  } catch (error) {
    log.err("demo blocked by unresolved payment journal", {
      reason: error instanceof Error ? error.message : String(error),
    });
    log.info("run `ackrate settlement reconcile` before starting another demo");
    process.exitCode = 1;
    return;
  }

  if (options.network !== undefined && options.network !== "testnet" && options.network !== "mainnet") {
    throw new Error("--network must be testnet or mainnet");
  }
  const network = options.network ?? "testnet";
  console.log("\n" + banner(network === "mainnet" ? "stellar mainnet · real USDC" : "stellar testnet · XLM") + "\n");
  log.info(`research agent demo — ${network === "mainnet" ? "real USDC on Stellar mainnet" : "testnet XLM"}; the contract caps the budget`);
  await executeDemo(network === "mainnet" ? await mainnetRuntime(options) : await testnetRuntime());
}
