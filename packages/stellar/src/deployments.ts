import { Asset, Networks } from "@stellar/stellar-sdk";
import { MAINNET_USDC, mainnetNetworkFromDeploymentManifest, type ReleaseNetworkConfig } from "./release-manifest.js";

/**
 * Single source of truth for Ackrate's deployed contract addresses.
 *
 * An address lives in exactly one place: here. Everything else — the SDK network
 * config (`config.ts`), the generated contract binding (`client.ts`), the scripts,
 * and the reference apps — reads from this module, so there is never a second copy
 * to keep in sync.
 *
 * The testnet `mandateRegistryId` is the permanent same-address upgrade target.
 * `npm run deploy:testnet` writes experimental deployments only to `.env`; it does
 * not rewrite this published default. To point at a different deployment at
 * runtime without editing source, pass a custom `NetworkConfig` to any SDK call.
 */
export const DEPLOYMENTS = Object.freeze({
  testnet: {
    /** Deployed MandateRegistry contract id. */
    mandateRegistryId: "CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM",
    /** Native XLM Stellar Asset Contract — a real SEP-41 token. */
    nativeSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  /** Published identity, not an implicit signing configuration or live-state check. */
  mainnet: Object.freeze({
    mandateRegistryId: "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR",
    nativeSac: Asset.native().contractId(Networks.PUBLIC),
    settlementAsset: MAINNET_USDC,
    schemaVersion: 2,
    sourceRepository: "https://github.com/ackrate/ackrate-protocol-contracts",
    sourceDirectory: "contracts/mainnet-v2/mandate-registry",
    sourceVersion: "0.4.1",
    sourceCommit: "02d43f5358aa567447447e44407546b6c7de1683",
    registryWasmSha256: "982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62",
    registryInterfaceSha256: "69c201ce1fb089ccfef06f125826b0aeba72af1b1536cb0b19e8cb05970ee805",
    registryWasmSizeBytes: 15_510,
    deploymentLedger: 64_208_356,
    deploymentTransactionHash: "28df0baad437bde0409cebe002c528d3f6a3306dd1e0671a15fa1c4c47b961cd",
    wasmUploadTransactionHash: "f7596369a41218fbb55114a84322feb0b705d80864edca48657e2dbc6a209368",
    authorityAccount: "GCIURCX7JHEKQLRTW6RDZU7OJUVCDM7WWNQPIKRERIHQOHSLW7UY7TXG",
    deploymentRecordUrl: "https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md",
    artifactUrl: "https://github.com/ackrate/ackrate-protocol-contracts/releases/download/v2-source-verify-v0.4.1.6_mandate-registry_pkg0.4.1_cli27.0.0/mandate-registry_v0.4.1.wasm",
  }),
} as const);

/**
 * Validate a complete manifest, then require the published Mainnet V2 identity.
 * This performs no network request, signing, or spending. The caller must still
 * verify current chain state and explicitly authorize any real-value action.
 */
export function publishedMainnetNetworkFromDeploymentManifest(manifest: unknown): ReleaseNetworkConfig {
  const network = mainnetNetworkFromDeploymentManifest(manifest);
  const expected = DEPLOYMENTS.mainnet;
  if (network.mandateRegistryId !== expected.mandateRegistryId
    || network.nativeSac !== expected.nativeSac
    || network.settlementAsset.contractId !== expected.settlementAsset.contractId) {
    throw new Error("release manifest does not match the published Mainnet deployment");
  }
  const identity = {
    schemaVersion: expected.schemaVersion, sourceCommit: expected.sourceCommit,
    deploymentLedger: expected.deploymentLedger, registryWasmSha256: expected.registryWasmSha256,
    registryInterfaceSha256: expected.registryInterfaceSha256, authorityAccount: expected.authorityAccount,
    deploymentTransactionHash: expected.deploymentTransactionHash, wasmUploadTransactionHash: expected.wasmUploadTransactionHash,
  };
  for (const key of Object.keys(identity) as Array<keyof typeof identity>) {
    if (network.release[key] !== identity[key]) throw new Error(`release manifest differs from the published Mainnet deployment: ${key}`);
  }
  // The general manifest parser checks presence and format; the published
  // profile additionally fixes the original package and artifact size.
  const details = manifest as { source: { version: string }; artifacts: { mandate_registry: { size_bytes: number } } };
  if (details.source.version !== expected.sourceVersion || details.artifacts.mandate_registry.size_bytes !== expected.registryWasmSizeBytes) {
    throw new Error("release manifest differs from the published Mainnet artifact");
  }
  return network;
}
