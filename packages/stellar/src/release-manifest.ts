import { Address, Asset, Networks, StrKey } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./config.js";

export const MAINNET_USDC = Object.freeze({
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
});

export const MAINNET_MIN_TIMELOCK_DELAY_LEDGERS = 17_280;
export const MAINNET_BUILD_PLATFORM = "ubuntu-24.04-x86_64";
export const MAINNET_RUST_TOOLCHAIN_VERSION = "1.96.0";
export const MAINNET_STELLAR_CLI_VERSION = "27.0.0";

export interface ReleaseNetworkConfig extends NetworkConfig {
  settlementAsset: {
    code: "USDC";
    issuer: string;
    contractId: string;
    decimals: number;
  };
  release: {
    sourceCommit: string;
    deploymentLedger: number;
    registryWasmSha256: string;
    timelockContractId: string;
    timelockWasmSha256: string;
  };
}

type JsonObject = Record<string, unknown>;

function objectAt(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`release manifest ${key} must be an object`);
  }
  return value as JsonObject;
}

function textAt(parent: JsonObject, key: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`release manifest ${key} must be a non-empty string`);
  }
  return value;
}

function integerAt(parent: JsonObject, key: string): number {
  const value = parent[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`release manifest ${key} must be a positive integer`);
  }
  return value as number;
}

function arrayAt(parent: JsonObject, key: string): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`release manifest ${key} must be an array`);
  return value;
}

function trueAt(parent: JsonObject, key: string): void {
  if (parent[key] !== true) throw new Error(`release manifest verification.${key} must be true`);
}

function sha256At(parent: JsonObject, key: string): string {
  const value = textAt(parent, key).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`release manifest ${key} must be a lowercase SHA-256`);
  }
  return value;
}

function transactionHashAt(parent: JsonObject, key: string): string {
  const value = textAt(parent, key).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`release manifest ${key} must be a Stellar transaction hash`);
  }
  return value;
}

function addressAt(parent: JsonObject, key: string, contractOnly = false): string {
  const value = textAt(parent, key);
  try {
    Address.fromString(value);
  } catch {
    throw new Error(`release manifest ${key} must be a Stellar address`);
  }
  if (contractOnly && !StrKey.isValidContract(value)) {
    throw new Error(`release manifest ${key} must be a Stellar contract address`);
  }
  return value;
}

function accountAt(parent: JsonObject, key: string): string {
  const value = addressAt(parent, key);
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(`release manifest ${key} must be a Stellar G-account`);
  }
  return value;
}

function exactDateAt(parent: JsonObject, key: string): string {
  const value = textAt(parent, key);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`release manifest ${key} must be a canonical ISO timestamp`);
  }
  return value;
}

/**
 * Convert the completed contracts deployment manifest into SDK configuration.
 * There is deliberately no built-in mainnet default: a partial, stale, or
 * internally inconsistent manifest fails closed before a wallet is prompted.
 */
export function mainnetNetworkFromDeploymentManifest(input: unknown): ReleaseNetworkConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("release manifest must be an object");
  }
  const manifest = input as JsonObject;
  if (manifest.schema_version !== 1) throw new Error("unsupported release manifest schema_version");

  const network = objectAt(manifest, "network");
  if (textAt(network, "name") !== "mainnet") throw new Error("release manifest network must be mainnet");
  if (textAt(network, "passphrase") !== Networks.PUBLIC) {
    throw new Error("release manifest has the wrong mainnet passphrase");
  }
  const rpcUrl = textAt(network, "rpc_url");
  const parsedRpc = new URL(rpcUrl);
  if (parsedRpc.protocol !== "https:" || parsedRpc.username || parsedRpc.password) {
    throw new Error("release manifest rpc_url must be credential-free HTTPS");
  }

  const source = objectAt(manifest, "source");
  if (textAt(source, "repository") !== "https://github.com/ackrate/ackrate-protocol-contracts") {
    throw new Error("release manifest source repository is not the canonical contracts repository");
  }
  const sourceCommit = textAt(source, "commit").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("release manifest source commit is invalid");
  if (textAt(source, "branch") !== "main") throw new Error("release manifest source branch must be main");
  if (textAt(source, "build_platform") !== MAINNET_BUILD_PLATFORM) {
    throw new Error(`release manifest build platform must be ${MAINNET_BUILD_PLATFORM}`);
  }
  if (textAt(source, "rust_toolchain_version") !== MAINNET_RUST_TOOLCHAIN_VERSION) {
    throw new Error(`release manifest Rust toolchain version must be ${MAINNET_RUST_TOOLCHAIN_VERSION}`);
  }
  if (textAt(source, "stellar_cli_version") !== MAINNET_STELLAR_CLI_VERSION) {
    throw new Error(`release manifest Stellar CLI version must be ${MAINNET_STELLAR_CLI_VERSION}`);
  }
  if (source.dirty !== false) throw new Error("release manifest source must be clean");

  const artifacts = objectAt(manifest, "artifacts");
  const timelockArtifact = objectAt(artifacts, "timelock_controller");
  const registryArtifact = objectAt(artifacts, "mandate_registry");
  const timelockWasmSha256 = sha256At(timelockArtifact, "sha256");
  const registryWasmSha256 = sha256At(registryArtifact, "sha256");
  integerAt(timelockArtifact, "size_bytes");
  integerAt(registryArtifact, "size_bytes");

  const publicConfiguration = objectAt(manifest, "public_configuration");
  if (textAt(publicConfiguration, "usdc_asset_code") !== MAINNET_USDC.code) {
    throw new Error("release manifest asset code must be USDC");
  }
  if (textAt(publicConfiguration, "usdc_issuer") !== MAINNET_USDC.issuer) {
    throw new Error("release manifest USDC issuer is not Circle's published Stellar mainnet issuer");
  }
  const authorityAccount = accountAt(publicConfiguration, "authority_2_of_3_account");
  const emergencyPauser = accountAt(publicConfiguration, "emergency_pauser");
  accountAt(publicConfiguration, "deployment_source_account");
  if (authorityAccount === emergencyPauser) {
    throw new Error("release manifest emergency pauser must be separate from the 2-of-3 authority");
  }
  const usdcContractId = addressAt(publicConfiguration, "usdc_sac", true);
  if (usdcContractId !== MAINNET_USDC.contractId) {
    throw new Error("release manifest USDC SAC is not the canonical Stellar mainnet asset contract");
  }
  textAt(publicConfiguration, "usdc_derivation_evidence");
  textAt(publicConfiguration, "usdc_independent_verifier");
  const timelockDelay = integerAt(publicConfiguration, "timelock_min_delay_ledgers");
  if (timelockDelay < MAINNET_MIN_TIMELOCK_DELAY_LEDGERS || timelockDelay > 0xffff_ffff) {
    throw new Error("release manifest timelock delay must be at least 17280 ledgers and fit u32");
  }

  const deployment = objectAt(manifest, "deployment");
  textAt(deployment, "authorized_by");
  const authorizedAt = exactDateAt(deployment, "authorized_at");
  const deployedAt = exactDateAt(deployment, "deployed_at");
  if (Date.parse(deployedAt) < Date.parse(authorizedAt)) {
    throw new Error("release manifest deployment predates authorization");
  }
  const deploymentLedger = integerAt(deployment, "ledger");
  transactionHashAt(deployment, "timelock_transaction_hash");
  transactionHashAt(deployment, "registry_transaction_hash");
  const timelockContractId = addressAt(deployment, "timelock_contract_id", true);
  const mandateRegistryId = addressAt(deployment, "registry_contract_id", true);
  if (sha256At(deployment, "timelock_observed_wasm_hash") !== timelockWasmSha256) {
    throw new Error("release manifest timelock artifact and observed WASM hashes differ");
  }
  if (sha256At(deployment, "registry_observed_wasm_hash") !== registryWasmSha256) {
    throw new Error("release manifest registry artifact and observed WASM hashes differ");
  }
  if (new Set([timelockContractId, mandateRegistryId, usdcContractId]).size !== 3) {
    throw new Error("release manifest contract identities must be distinct");
  }

  const constructorArguments = objectAt(manifest, "constructor_arguments");
  const timelockArguments = objectAt(constructorArguments, "timelock");
  const proposers = arrayAt(timelockArguments, "proposers");
  if (proposers.length !== 1 || proposers[0] !== authorityAccount) {
    throw new Error("release manifest timelock proposer must be the 2-of-3 authority");
  }
  if (arrayAt(timelockArguments, "executors").length !== 0) {
    throw new Error("release manifest timelock executors must be empty for permissionless execution");
  }
  if (timelockArguments.admin !== null) {
    throw new Error("release manifest timelock admin must be null for self-administration");
  }

  const registryArguments = objectAt(constructorArguments, "mandate_registry");
  for (const key of ["admin", "asset_policy", "upgrader"]) {
    if (addressAt(registryArguments, key, true) !== timelockContractId) {
      throw new Error(`release manifest registry ${key} must be the timelock`);
    }
  }
  if (accountAt(registryArguments, "unpauser") !== authorityAccount) {
    throw new Error("release manifest registry unpauser must be the 2-of-3 authority");
  }
  if (accountAt(registryArguments, "pauser") !== emergencyPauser) {
    throw new Error("release manifest registry pauser must be the emergency key");
  }
  if (addressAt(registryArguments, "initial_asset", true) !== usdcContractId) {
    throw new Error("release manifest registry initial asset must be the canonical USDC SAC");
  }

  const verification = objectAt(manifest, "verification");
  for (const key of [
    "artifact_hashes_match",
    "constructor_arguments_match",
    "timelock_self_administered",
    "authority_is_proposer_and_canceller",
    "executor_is_permissionless_after_delay",
    "registry_admin_is_timelock",
    "registry_asset_policy_is_timelock",
    "registry_upgrader_is_timelock",
    "registry_unpauser_is_2_of_3",
    "registry_pauser_is_emergency_key",
    "registry_initially_unpaused",
    "registry_usdc_asset_allowed",
  ]) trueAt(verification, key);
  textAt(verification, "independent_read_only_verifier");
  const verifiedAt = exactDateAt(verification, "verified_at");
  if (Date.parse(verifiedAt) < Date.parse(deployedAt)) {
    throw new Error("release manifest verification predates deployment");
  }

  return Object.freeze({
    rpcUrl,
    networkPassphrase: Networks.PUBLIC,
    mandateRegistryId,
    nativeSac: Asset.native().contractId(Networks.PUBLIC),
    settlementAsset: Object.freeze({
      code: MAINNET_USDC.code,
      issuer: MAINNET_USDC.issuer,
      contractId: usdcContractId,
      decimals: 7,
    }),
    release: Object.freeze({
      sourceCommit,
      deploymentLedger,
      registryWasmSha256,
      timelockContractId,
      timelockWasmSha256,
    }),
  });
}
