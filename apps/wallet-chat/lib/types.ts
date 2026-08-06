export type NetworkName = "testnet" | "mainnet";

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  path: string;
  price: string;
}

export interface SafeAppConfig {
  network: NetworkName;
  networkLabel: "Stellar Testnet" | "Stellar Mainnet";
  releaseState: "configuration-required" | "testnet-ready" | "mainnet-ready";
  ready: boolean;
  blockers: string[];
  rpcUrl: string;
  networkPassphrase: string;
  mandateRegistryId: string;
  asset: {
    code: string;
    contractId: string;
    decimals: number;
  };
  agentAddress: string | null;
  merchant: {
    address: string | null;
    name: string;
  };
  catalog: CatalogItem[];
  explorerNetwork: "testnet" | "public";
  sourceCommit: string | null;
  releaseFingerprint: string | null;
  durableState: boolean;
  wallet: {
    name: "LOBSTR";
    signingMode: "G-account transaction signing";
    authEntrySigning: false;
  };
}

export interface MandateView {
  id: string;
  user: string;
  agent: string;
  merchant: string;
  asset: string;
  maxAmount: string;
  spent: string;
  remaining: string;
  expiry: number;
  seq: number;
  status: "Active" | "Revoked" | "Exhausted";
}

export interface SessionView {
  authenticated: boolean;
  address: string | null;
  network: NetworkName | null;
  expiresAt: number | null;
}
