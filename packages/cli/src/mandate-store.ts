/**
 * Mandate store: the active mandate's inputs + on-chain ids, written to
 * ~/.ackrate/mandate.json. NOT secret (no private keys) — it holds the exact
 * CreateIntentMandateInput (incl. nonce + expiry) so `ackrate pay` can rebuild
 * the identical mandate id the contract registered.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateIntentMandateInput } from "@ackrate/core";
import { ackrateHome } from "./secrets.js";

export type StoredMandate = {
  version: 2;
  network: "testnet" | "mainnet";
  contractId: string;
  inputs: CreateIntentMandateInput;
  id: string;
  registerTx: string;
  approveTx: string;
};

export function mandatePath(): string {
  return join(ackrateHome(), "mandate.json");
}

export function mandateExists(): boolean {
  return existsSync(mandatePath());
}

export function loadMandate(): StoredMandate {
  const raw = JSON.parse(readFileSync(mandatePath(), "utf8")) as Partial<StoredMandate>;
  if (raw.version === 2) return raw as StoredMandate;
  // Existing testnet-only records predate the network binding.
  if (raw.inputs && raw.id && raw.registerTx && raw.approveTx) {
    return { ...raw, version: 2, network: "testnet", contractId: "" } as StoredMandate;
  }
  throw new Error("stored mandate schema is invalid");
}

export function saveMandate(m: StoredMandate): string {
  mkdirSync(ackrateHome(), { recursive: true, mode: 0o700 });
  chmodSync(ackrateHome(), 0o700);
  const path = mandatePath();
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
  return path;
}
