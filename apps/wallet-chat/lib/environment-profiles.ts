import type { NetworkName } from "./types";

export type EnvironmentProfileId = "staging" | "mainnet";

export interface EnvironmentDestination {
  id: EnvironmentProfileId;
  label: "Staging" | "Mainnet";
  deployment: "staging" | "production";
  network: NetworkName;
  assetLabel: "Test XLM" | "Real USDC";
  origin: string | null;
}

export const ENVIRONMENT_ORIGINS = Object.freeze({
  staging: "https://ackrate-ackrate-protocol-staging-54c60f4b.vercel.app",
  mainnet: "https://ackrate-ackrate-protocol-e56a218.vercel.app",
});

/** Destinations are opt-in and cannot redirect a wallet to an arbitrary origin. */
export function environmentDestinations(env: Readonly<Record<string, string | undefined>>): { destinations: EnvironmentDestination[]; warnings: string[] } {
  const warnings: string[] = [];
  const destinations = (["staging", "mainnet"] as const).map((id): EnvironmentDestination => {
    const variable = id === "staging" ? "ACKRATE_STAGING_APP_ORIGIN" : "ACKRATE_MAINNET_APP_ORIGIN";
    let origin = env[variable]?.trim() || null;
    if (origin && origin !== ENVIRONMENT_ORIGINS[id]) {
      warnings.push(`${variable} must match the approved ${id} HTTPS origin`);
      origin = null;
    }
    return {
      id,
      label: id === "staging" ? "Staging" : "Mainnet",
      deployment: id === "staging" ? "staging" : "production",
      network: id === "staging" ? "testnet" : "mainnet",
      assetLabel: id === "staging" ? "Test XLM" : "Real USDC",
      origin,
    };
  });
  return { destinations, warnings };
}

export function environmentProfile(env: Readonly<Record<string, string | undefined>>): EnvironmentProfileId {
  const network = env.ACKRATE_WALLET_NETWORK?.trim();
  if (network && network !== "testnet" && network !== "mainnet") throw new Error("ACKRATE_WALLET_NETWORK must be testnet or mainnet");
  const profile = env.ACKRATE_APP_PROFILE?.trim() || (network === "mainnet" ? "mainnet" : "staging");
  if (profile !== "staging" && profile !== "mainnet") throw new Error("ACKRATE_APP_PROFILE must be staging or mainnet");
  if (network && network !== (profile === "staging" ? "testnet" : "mainnet")) throw new Error("application profile and wallet network disagree");
  return profile;
}

/** Saved mandates never cross a deployment, contract, asset, or authority profile. */
export function mandateStorageKey(profileFingerprint: string, address: string): string {
  return `ackrate:mandate:v2:${profileFingerprint}:${address}`;
}
