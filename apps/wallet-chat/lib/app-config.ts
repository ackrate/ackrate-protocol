import { createHash } from "node:crypto";
import { Asset, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { TESTNET, mainnetNetworkFromDeploymentManifest, type NetworkConfig } from "@ackrate/stellar";
import type { CatalogItem, NetworkName, SafeAppConfig } from "./types";

export const MAINNET_CONFIRMATION = "ACTIVATE_VERIFIED_ACKRATE_MAINNET";

const DEFAULT_CATALOG: CatalogItem[] = [
  {
    id: "market-brief",
    title: "Market signal brief",
    description: "A compact, payment-gated research signal from the configured merchant.",
    path: "/source/market-brief",
    price: "1.00",
  },
];

export interface AppConfig {
  public: SafeAppConfig;
  network: NetworkConfig;
  agentSecret: string | null;
  merchantUrl: string | null;
  sessionSecret: string | null;
  openAiKey: string | null;
  openAiModel: string;
  databaseUrl: string | null;
}

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function gAddress(value: string | null): value is string {
  return Boolean(value && StrKey.isValidEd25519PublicKey(value));
}

function readCatalog(raw: string | null): CatalogItem[] {
  if (!raw) return DEFAULT_CATALOG;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 12) {
    throw new Error("ACKRATE_CHAT_CATALOG_JSON must contain between 1 and 12 entries");
  }
  const ids = new Set<string>();
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`catalog entry ${index} must be an object`);
    }
    const item = entry as Record<string, unknown>;
    for (const field of ["id", "title", "description", "path", "price"]) {
      if (typeof item[field] !== "string" || !(item[field] as string).trim()) {
        throw new Error(`catalog entry ${index}.${field} must be a non-empty string`);
      }
    }
    const id = item.id as string;
    const path = item.path as string;
    const price = item.price as string;
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id) || ids.has(id)) {
      throw new Error(`catalog entry ${index}.id must be unique lowercase kebab-case`);
    }
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("#")) {
      throw new Error(`catalog entry ${index}.path must be a safe origin-relative path`);
    }
    if (!/^\d+(\.\d{1,7})?$/.test(price) || Number(price) <= 0) {
      throw new Error(`catalog entry ${index}.price must be a positive Stellar amount`);
    }
    ids.add(id);
    return { id, title: item.title as string, description: item.description as string, path, price };
  });
}

function safeMerchantUrl(raw: string | null): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ACKRATE_CHAT_MERCHANT_URL must be a credential-free HTTPS origin");
  }
  return url.origin;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const requested = present(env.ACKRATE_WALLET_NETWORK) ?? "testnet";
  if (requested !== "testnet" && requested !== "mainnet") {
    throw new Error("ACKRATE_WALLET_NETWORK must be testnet or mainnet");
  }
  const networkName = requested as NetworkName;
  let network: NetworkConfig = TESTNET;
  let asset = { code: "XLM", contractId: TESTNET.nativeSac, decimals: 7 };
  let releaseFingerprint: string | null = null;
  const blockers: string[] = [];

  if (networkName === "mainnet") {
    network = {
      rpcUrl: "",
      networkPassphrase: Networks.PUBLIC,
      mandateRegistryId: "",
      nativeSac: Asset.native().contractId(Networks.PUBLIC),
    };
    asset = { code: "USDC", contractId: "", decimals: 7 };
    if (env.ACKRATE_ENABLE_MAINNET !== MAINNET_CONFIRMATION) {
      blockers.push(`ACKRATE_ENABLE_MAINNET must equal ${MAINNET_CONFIRMATION}`);
    }
    const manifestJson = present(env.ACKRATE_MAINNET_DEPLOYMENT_MANIFEST_JSON);
    if (!manifestJson) {
      blockers.push("completed mainnet deployment manifest is missing");
    } else {
      try {
        const release = mainnetNetworkFromDeploymentManifest(JSON.parse(manifestJson));
        network = release;
        asset = release.settlementAsset;
        releaseFingerprint = createHash("sha256")
          .update(JSON.stringify({
            registry: release.mandateRegistryId,
            asset: release.settlementAsset.contractId,
            commit: release.release.sourceCommit,
            registryWasm: release.release.registryWasmSha256,
            deploymentLedger: release.release.deploymentLedger,
          }))
          .digest("hex");
      } catch (error) {
        blockers.push(`mainnet deployment manifest rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const agentAddress = present(env.ACKRATE_CHAT_AGENT_PUBLIC_KEY);
  const merchantAddress = present(env.ACKRATE_CHAT_MERCHANT_PUBLIC_KEY);
  if (!gAddress(agentAddress)) blockers.push("valid agent G-address is missing");
  if (!gAddress(merchantAddress)) blockers.push("valid merchant G-address is missing");

  const agentSecret = present(env.ACKRATE_CHAT_AGENT_SECRET);
  if (!agentSecret) {
    blockers.push("server-only agent signer is missing");
  } else {
    try {
      const derived = Keypair.fromSecret(agentSecret).publicKey();
      if (agentAddress && derived !== agentAddress) blockers.push("agent signer does not match the public agent address");
    } catch {
      blockers.push("server-only agent signer is invalid");
    }
  }

  let merchantUrl: string | null = null;
  try {
    merchantUrl = safeMerchantUrl(present(env.ACKRATE_CHAT_MERCHANT_URL));
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (!merchantUrl) blockers.push("merchant HTTPS origin is missing");

  const sessionSecret = present(env.ACKRATE_SESSION_SECRET);
  if (!sessionSecret || Buffer.byteLength(sessionSecret, "utf8") < 32) {
    blockers.push("session secret must contain at least 32 bytes");
  }
  const openAiKey = present(env.OPENAI_API_KEY);
  if (!openAiKey) blockers.push("OpenAI API key is missing");
  const databaseUrl = present(env.DATABASE_URL);
  if (networkName === "mainnet" && !databaseUrl) blockers.push("durable DATABASE_URL is required on mainnet");

  let catalog = DEFAULT_CATALOG;
  try {
    catalog = readCatalog(present(env.ACKRATE_CHAT_CATALOG_JSON));
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const sourceCommit = present(env.ACKRATE_APP_SOURCE_COMMIT);
  if (networkName === "mainnet" && (!sourceCommit || !/^[0-9a-f]{40}$/.test(sourceCommit))) {
    blockers.push("exact 40-character application source commit is required on mainnet");
  }
  const appOrigin = present(env.ACKRATE_APP_ORIGIN);
  if (appOrigin) {
    try {
      const parsed = new URL(appOrigin);
      if (parsed.protocol !== "https:" || parsed.origin !== appOrigin || parsed.username || parsed.password) {
        throw new Error();
      }
    } catch {
      blockers.push("ACKRATE_APP_ORIGIN must be an exact credential-free HTTPS origin");
    }
  } else if (networkName === "mainnet") {
    blockers.push("exact hosted application origin is required on mainnet");
  }

  const ready = blockers.length === 0;
  const publicConfig: SafeAppConfig = {
    network: networkName,
    networkLabel: networkName === "mainnet" ? "Stellar Mainnet" : "Stellar Testnet",
    releaseState: ready ? (networkName === "mainnet" ? "mainnet-ready" : "testnet-ready") : "configuration-required",
    ready,
    blockers,
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
    mandateRegistryId: network.mandateRegistryId,
    asset,
    agentAddress: gAddress(agentAddress) ? agentAddress : null,
    merchant: {
      address: gAddress(merchantAddress) ? merchantAddress : null,
      name: present(env.ACKRATE_CHAT_MERCHANT_NAME) ?? "Research Source",
    },
    catalog,
    explorerNetwork: networkName === "mainnet" ? "public" : "testnet",
    sourceCommit,
    releaseFingerprint,
    durableState: Boolean(databaseUrl),
    wallet: {
      name: "LOBSTR",
      signingMode: "G-account transaction signing",
      authEntrySigning: false,
    },
  };

  return {
    public: publicConfig,
    network,
    agentSecret,
    merchantUrl,
    sessionSecret,
    openAiKey,
    openAiModel: present(env.OPENAI_MODEL) ?? "gpt-5-mini",
    databaseUrl,
  };
}

export function requireReadyConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = loadAppConfig(env);
  if (!config.public.ready) {
    throw new Error(`application configuration is blocked: ${config.public.blockers.join("; ")}`);
  }
  return config;
}
