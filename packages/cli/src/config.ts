/** Public, committable project configuration for the official Mainnet registry.
 * Optional deployment files are checked against that registry and hash-pinned. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import {
  MAINNET,
  TESTNET,
  publishedMainnetNetworkFromDeploymentManifest,
  type NetworkConfig,
  type ReleaseNetworkConfig,
} from "@ackrate/stellar";

export const CONFIG_FILE = "ackrate.config.json";

interface ConfigBase {
  schemaVersion: 1;
  explorer: string;
  unlockPrice: string;
  budget: string;
}

export interface TestnetConfig extends ConfigBase {
  network: "testnet";
  contractId: string;
}

export interface MainnetConfig extends ConfigBase {
  network: "mainnet";
  contractId: string;
  manifestPath?: string;
  manifestSha256?: string;
  userSigner: string;
  agentSigner: string;
  merchant: string;
  agentSecretEnv?: string;
}

export type AckrateConfig = TestnetConfig | MainnetConfig;

const AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty exact string`);
  }
  return value;
}

function amount(value: unknown, label: string): string {
  const text = exactText(value, label);
  if (!AMOUNT.test(text) || Number(text) <= 0) {
    throw new Error(`${label} must be a positive amount with at most 7 decimals`);
  }
  return text;
}

function signerName(value: unknown, label: string): string {
  const text = exactText(value, label);
  if (text.length > 128 || /[\r\n\0]/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function exactKeys(raw: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(raw).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error("Ackrate config contains missing or unknown fields");
  }
}

function parseConfig(input: unknown): AckrateConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Ackrate config must be an object");
  }
  const raw = input as Record<string, unknown>;
  const schemaVersion = raw.schemaVersion ?? (raw.network === "testnet" ? 1 : undefined);
  if (schemaVersion !== 1) throw new Error("unsupported Ackrate config schemaVersion");
  const explorer = exactText(raw.explorer, "config explorer");
  const parsedExplorer = new URL(explorer);
  if (parsedExplorer.protocol !== "https:" || parsedExplorer.username || parsedExplorer.password) {
    throw new Error("config explorer must be credential-free HTTPS");
  }
  const unlockPrice = amount(raw.unlockPrice, "config unlockPrice");
  const budget = amount(raw.budget, "config budget");
  if (raw.network === "testnet") {
    exactKeys(raw, raw.schemaVersion === undefined
      ? ["network", "contractId", "explorer", "unlockPrice", "budget"]
      : ["schemaVersion", "network", "contractId", "explorer", "unlockPrice", "budget"]);
    const contractId = exactText(raw.contractId, "config contractId");
    if (!StrKey.isValidContract(contractId)) throw new Error("config contractId must be a Stellar contract");
    return Object.freeze({ schemaVersion: 1, network: "testnet", contractId, explorer, unlockPrice, budget });
  }
  if (raw.network !== "mainnet") throw new Error("config network must be testnet or mainnet");
  const hasManifest = raw.manifestPath !== undefined || raw.manifestSha256 !== undefined;
  // Old manifest-based projects predate the explicit contractId field. They are
  // normalized to the official registry, then their actual manifest is checked
  // before use; no alternate deployment can be selected by omitting the field.
  const legacyManifestConfig = hasManifest && raw.contractId === undefined;
  exactKeys(raw, [
    "schemaVersion", "network", "explorer", "unlockPrice", "budget", "userSigner", "agentSigner", "merchant",
    ...(!legacyManifestConfig ? ["contractId"] : []),
    ...(hasManifest ? ["manifestPath", "manifestSha256"] : []),
    ...(raw.agentSecretEnv !== undefined ? ["agentSecretEnv"] : []),
  ]);
  const contractId = legacyManifestConfig
    ? MAINNET.mandateRegistryId
    : exactText(raw.contractId, "config contractId");
  if (contractId !== MAINNET.mandateRegistryId) {
    throw new Error(`Mainnet config contractId must match the official registry ${MAINNET.mandateRegistryId}`);
  }
  let manifestPath: string | undefined;
  let manifestSha256: string | undefined;
  if (hasManifest) {
    manifestPath = exactText(raw.manifestPath, "config manifestPath");
    manifestSha256 = exactText(raw.manifestSha256, "config manifestSha256");
    if (!SHA256.test(manifestSha256)) throw new Error("config manifestSha256 must be lowercase SHA-256");
  }
  const merchant = exactText(raw.merchant, "config merchant");
  if (!StrKey.isValidEd25519PublicKey(merchant)) throw new Error("config merchant must be a Stellar G-account");
  const userSigner = signerName(raw.userSigner, "config userSigner");
  const agentSigner = signerName(raw.agentSigner, "config agentSigner");
  let agentSecretEnv: string | undefined;
  if (raw.agentSecretEnv !== undefined) {
    agentSecretEnv = exactText(raw.agentSecretEnv, "config agentSecretEnv");
    if (!ENV_NAME.test(agentSecretEnv)) throw new Error("config agentSecretEnv must be an uppercase environment-variable name");
  }
  return Object.freeze({
    schemaVersion: 1,
    network: "mainnet",
    contractId,
    ...(manifestPath ? { manifestPath, manifestSha256 } : {}),
    explorer,
    unlockPrice,
    budget,
    userSigner,
    agentSigner,
    merchant,
    ...(agentSecretEnv ? { agentSecretEnv } : {}),
  });
}

export function testnetConfig(): TestnetConfig {
  return {
    schemaVersion: 1,
    network: "testnet",
    contractId: TESTNET.mandateRegistryId,
    explorer: "https://stellar.expert/explorer/testnet",
    unlockPrice: "1.00",
    budget: "3.00",
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface MainnetConfigInput {
  manifestPath?: string;
  userSigner: string;
  agentSigner: string;
  merchant: string;
  unlockPrice: string;
  budget: string;
  agentSecretEnv?: string;
}

/** Public actors are explicit; the deployed contract and network are built in. */
export function defaultConfig(input: MainnetConfigInput, cwd: string = process.cwd()): MainnetConfig {
  return createMainnetConfig(input, cwd);
}

export function createMainnetConfig(input: MainnetConfigInput, cwd: string = process.cwd()): MainnetConfig {
  let manifestSha256: string | undefined;
  if (input.manifestPath !== undefined) {
    const path = exactText(input.manifestPath, "config manifestPath");
    const bytes = readFileSync(resolve(cwd, path));
    publishedMainnetNetworkFromDeploymentManifest(JSON.parse(bytes.toString("utf8")) as unknown);
    manifestSha256 = createHash("sha256").update(bytes).digest("hex");
  }
  return parseConfig({
    schemaVersion: 1,
    network: "mainnet",
    contractId: MAINNET.mandateRegistryId,
    ...(input.manifestPath !== undefined ? { manifestPath: input.manifestPath, manifestSha256 } : {}),
    explorer: "https://stellar.expert/explorer/public",
    unlockPrice: input.unlockPrice,
    budget: input.budget,
    userSigner: input.userSigner,
    agentSigner: input.agentSigner,
    merchant: input.merchant,
    ...(input.agentSecretEnv ? { agentSecretEnv: input.agentSecretEnv } : {}),
  }) as MainnetConfig;
}

export function networkConfig(config: AckrateConfig, cwd: string = process.cwd()): NetworkConfig | ReleaseNetworkConfig {
  const checked = parseConfig(config);
  if (checked.network === "testnet") return { ...TESTNET, mandateRegistryId: checked.contractId };
  if (!checked.manifestPath) return MAINNET;
  const bytes = readFileSync(resolve(cwd, checked.manifestPath));
  if (createHash("sha256").update(bytes).digest("hex") !== checked.manifestSha256) {
    throw new Error("mainnet deployment manifest no longer matches the SHA-256 pinned in ackrate.config.json");
  }
  return publishedMainnetNetworkFromDeploymentManifest(JSON.parse(bytes.toString("utf8")) as unknown);
}

export function configPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILE);
}

export function configExists(cwd?: string): boolean {
  return existsSync(configPath(cwd));
}

export function loadConfig(cwd?: string): AckrateConfig {
  return parseConfig(JSON.parse(readFileSync(configPath(cwd), "utf8")) as unknown);
}

export function saveConfig(config: AckrateConfig, cwd?: string): string {
  const path = configPath(cwd);
  const checked = parseConfig(config);
  writeFileSync(path, `${JSON.stringify(checked, null, 2)}\n`, "utf8");
  return path;
}
