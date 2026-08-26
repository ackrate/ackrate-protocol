/**
 * Project config: a committable `ackrate.config.json` written by `ackrate init` into
 * the current directory. It holds NO secrets — the network, the on-chain contract
 * id (the source of truth), the explorer base, and the demo price/budget defaults.
 * Keys live elsewhere (`ackrate setup`) and are never written here.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TESTNET, type NetworkConfig } from "@ackrate/stellar";

export const CONFIG_FILE = "ackrate.config.json";

export type AckrateConfig = {
  network: "testnet";
  contractId: string;
  explorer: string;
  /** XLM per content unlock, mirrors the demo's UNLOCK_PRICE. */
  unlockPrice: string;
  /** Mandate cap in XLM, mirrors the demo's BUDGET. */
  budget: string;
};

export function defaultConfig(): AckrateConfig {
  return {
    network: "testnet",
    contractId: TESTNET.mandateRegistryId,
    explorer: "https://stellar.expert/explorer/testnet",
    unlockPrice: "1.00",
    budget: "3.00",
  };
}

export function networkConfig(config: AckrateConfig): NetworkConfig {
  return { ...TESTNET, mandateRegistryId: config.contractId };
}

export function configPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILE);
}

export function configExists(cwd?: string): boolean {
  return existsSync(configPath(cwd));
}

export function loadConfig(cwd?: string): AckrateConfig {
  return JSON.parse(readFileSync(configPath(cwd), "utf8")) as AckrateConfig;
}

export function saveConfig(config: AckrateConfig, cwd?: string): string {
  const path = configPath(cwd);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return path;
}
