/**
 * `ackrate mandate create` — register an AP2 IntentMandate on-chain.
 *
 * Builds the mandate from the stored testnet keys, registers it, and approves the
 * SEP-41 allowance to the CONTRACT (never to the agent) — both user-signed.
 * Persists the inputs so `ackrate pay` rebuilds the identical mandate id. Mirrors
 * the demo's ackrate-server.setup(). The contract is the source of truth; this
 * tool is an untrusted client.
 */
import { ackrate, type CreateIntentMandateInput } from "@ackrate/core";
import { log, c } from "../ui.js";
import { configExists, loadConfig, networkConfig } from "../config.js";
import { credentialsExist, loadCredentials } from "../secrets.js";
import { mandateExists, saveMandate, type StoredMandate } from "../mandate-store.js";
import { mainnetProjectPreflight } from "../mainnet-preflight.js";

export type MandateCreateOptions = { budget?: string; expiry?: string; force?: boolean; confirmRealUsdc?: boolean };

const short = (s: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "");

export async function runMandateCreate(opts: MandateCreateOptions = {}): Promise<void> {
  if (!configExists()) {
    log.warn("no ackrate.config.json here — run `ackrate init` first");
    return;
  }
  if (mandateExists() && !opts.force) {
    log.warn("a mandate already exists — re-run with --force to replace it");
    return;
  }

  const config = loadConfig();
  if (config.network === "mainnet" && !opts.confirmRealUsdc) {
    throw new Error("mainnet mandate creation requires --confirm-real-usdc before any signer is opened");
  }
  const net = networkConfig(config);
  const txUrl = (hash: string) => `${config.explorer}/tx/${hash}`;

  const budget = opts.budget ?? config.budget;
  const expirySecs = opts.expiry ? Number(opts.expiry) : 3600;
  if (!Number.isFinite(expirySecs) || expirySecs <= 0) {
    log.err("--expiry must be a positive number of seconds");
    return;
  }
  if (config.network === "testnet" && !credentialsExist()) {
    log.warn("no credentials — run `ackrate setup` first");
    return;
  }
  const testnetCredentials = config.network === "testnet" ? loadCredentials() : undefined;
  const mainnet = config.network === "mainnet" ? await mainnetProjectPreflight(config, budget) : undefined;
  const user = mainnet?.userSigner.publicKey ?? testnetCredentials!.userPublic;
  const agent = mainnet?.agentSigner.publicKey ?? testnetCredentials!.agentPublic;
  const merchant = mainnet?.merchant ?? testnetCredentials!.merchantPublic;
  const asset = mainnet?.net.settlementAsset.contractId ?? ackrate.testnet.nativeSac;
  const symbol = config.network === "mainnet" ? "USDC" : "XLM";
  const signer = mainnet?.userSigner ?? testnetCredentials!.userSecret;

  const inputs: CreateIntentMandateInput = {
    user,
    agent,
    merchant,
    asset,
    maxAmount: budget,
    decimals: mainnet?.chainDecimals ?? 7,
    expiry: Math.floor(Date.now() / 1000) + expirySecs,
    nonce: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
  };

  const mandate = ackrate.createIntentMandate(inputs, net);
  log.step("authorizing mandate", {
    budget: `${budget} ${symbol}`,
    merchant: short(merchant),
    id: short(mandate.id),
  });

  const registerTx = await ackrate.registerMandate(mandate, { signer }, net);
  log.chain("register_mandate confirmed", { tx: short(registerTx) });

  const approveTx = await ackrate.approveBudget(mandate, { signer }, net);
  log.chain("approveBudget confirmed (SEP-41 allowance to contract)", { tx: short(approveTx) });

  const stored: StoredMandate = {
    version: 2,
    network: config.network,
    contractId: net.mandateRegistryId,
    inputs,
    id: mandate.id,
    registerTx,
    approveTx,
  };
  const path = saveMandate(stored);
  log.ok("mandate saved", { path });

  console.log(
    "\n" +
      c.bold("Mandate") +
      "\n" +
      c.gray("  id        ") + c.white(mandate.id) +
      "\n" +
      c.gray("  budget    ") + c.white(`${budget} ${symbol}`) +
      "\n" +
      c.gray("  register  ") + c.dim(txUrl(registerTx)) +
      "\n" +
      c.gray("  approve   ") + c.dim(txUrl(approveTx)) +
      "\n",
  );
  log.info("next", { run: "ackrate pay" });
}
