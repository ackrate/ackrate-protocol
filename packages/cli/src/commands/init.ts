/**
 * `ackrate init` — scaffold a project in the current directory by writing a
 * committable ackrate.config.json (network, contract id, explorer, demo defaults).
 * Idempotent: refuses to clobber an existing config unless --force is passed.
 */
import { banner, log, c } from "../ui.js";
import {
  CONFIG_FILE,
  configExists,
  configPath,
  createMainnetConfig,
  defaultConfig,
  saveConfig,
} from "../config.js";

export type InitOptions = {
  force?: boolean;
  network?: "testnet" | "mainnet" | string;
  manifest?: string;
  userSigner?: string;
  agentSigner?: string;
  merchant?: string;
  price?: string;
  budget?: string;
  agentSecretEnv?: string;
};

function required(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`mainnet init requires ${flag}`);
  return value.trim();
}

export function runInit(opts: InitOptions = {}): void {
  console.log("\n" + banner() + "\n");

  if (configExists() && !opts.force) {
    log.warn(`${CONFIG_FILE} already exists`, { path: configPath() });
    log.info("re-run with --force to overwrite, or edit it directly");
    return;
  }

  if (opts.network !== undefined && opts.network !== "testnet" && opts.network !== "mainnet") {
    throw new Error("--network must be testnet or mainnet");
  }
  const config = opts.network === "mainnet"
    ? createMainnetConfig({
        manifestPath: required(opts.manifest, "--manifest <path>"),
        userSigner: required(opts.userSigner, "--user-signer <identity>"),
        agentSigner: required(opts.agentSigner, "--agent-signer <identity>"),
        merchant: required(opts.merchant, "--merchant <G...>"),
        unlockPrice: required(opts.price, "--price <usdc>"),
        budget: required(opts.budget, "--budget <usdc>"),
        ...(opts.agentSecretEnv ? { agentSecretEnv: opts.agentSecretEnv } : {}),
      })
    : defaultConfig();
  const path = saveConfig(config);
  log.ok(`wrote ${CONFIG_FILE}`, { path });
  log.info("config", {
    network: config.network,
    contract: config.network === "testnet" ? config.contractId : "from verified manifest",
  });

  console.log(
    "\n" +
      c.bold("Next steps") +
      "\n" +
      c.gray("  1. ") +
      c.white("ackrate setup") +
      c.gray(config.network === "mainnet" ? "   run read-only Mainnet readiness checks" : "   configure keys + fund testnet accounts") +
      "\n" +
      c.gray("  2. ") +
      c.white("ackrate mandate create") +
      c.gray("   register an AP2 mandate on-chain") +
      "\n" +
      c.gray("  3. ") +
      c.white("ackrate pay") +
      c.gray("   make an agent-signed payment") +
      "\n",
  );
}
