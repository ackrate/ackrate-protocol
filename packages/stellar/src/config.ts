import { DEPLOYMENTS, MAINNET_DEPLOYMENT_MANIFEST, publishedMainnetNetworkFromDeploymentManifest } from "./deployments.js";
import type { ReleaseNetworkConfig } from "./release-manifest.js";

/** Network configuration for Ackrate's Soroban layer. */
export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  /** Deployed MandateRegistry contract id for this network. */
  mandateRegistryId: string;
  /** Native XLM Stellar Asset Contract (a real SEP-41 token) for this network. */
  nativeSac: string;
}

/** Official Ackrate Mainnet registry and canonical USDC, validated from bundled public deployment evidence. */
export const MAINNET: ReleaseNetworkConfig = publishedMainnetNetworkFromDeploymentManifest(MAINNET_DEPLOYMENT_MANIFEST);

/** Stellar testnet — the live, gatechecked MandateRegistry deployment. */
export const TESTNET: NetworkConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  mandateRegistryId: DEPLOYMENTS.testnet.mandateRegistryId,
  nativeSac: DEPLOYMENTS.testnet.nativeSac,
};
