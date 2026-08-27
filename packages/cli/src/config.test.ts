import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
import {
  CONFIG_FILE,
  createMainnetConfig,
  loadConfig,
  networkConfig,
  saveConfig,
  sha256File,
} from "./config.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ackrate-config-"));
  roots.push(path);
  return path;
}

test("legacy testnet config remains compatible and is normalized", async () => {
  const cwd = await root();
  await writeFile(join(cwd, CONFIG_FILE), JSON.stringify({
    network: "testnet",
    contractId: TESTNET.mandateRegistryId,
    explorer: "https://stellar.expert/explorer/testnet",
    unlockPrice: "1.00",
    budget: "3.00",
  }));
  const config = loadConfig(cwd);
  assert.equal(config.schemaVersion, 1);
  assert.equal(networkConfig(config, cwd).mandateRegistryId, TESTNET.mandateRegistryId);
});

test("mainnet config pins one manifest hash and rejects changed bytes", async () => {
  const cwd = await root();
  const manifestPath = join(cwd, "manifest.json");
  await writeFile(manifestPath, "{}\n");
  const config = {
    schemaVersion: 1 as const,
    network: "mainnet" as const,
    manifestPath: "manifest.json",
    manifestSha256: sha256File(manifestPath),
    explorer: "https://stellar.expert/explorer/public",
    unlockPrice: "0.01",
    budget: "0.03",
    userSigner: "user-identity",
    agentSigner: "agent-identity",
    merchant: Keypair.random().publicKey(),
    agentSecretEnv: "ACKRATE_AGENT_SECRET",
  };
  saveConfig(config, cwd);
  assert.throws(() => networkConfig(loadConfig(cwd), cwd), /schema_version/);
  await writeFile(manifestPath, "{\"changed\":true}\n");
  assert.throws(() => networkConfig(loadConfig(cwd), cwd), /no longer matches/);
});

test("mainnet init cannot pin a partial manifest", async () => {
  const cwd = await root();
  await writeFile(join(cwd, "manifest.json"), "{}\n");
  assert.throws(() => createMainnetConfig({
    manifestPath: "manifest.json",
    userSigner: "user",
    agentSigner: "agent",
    merchant: Keypair.random().publicKey(),
    unlockPrice: "0.01",
    budget: "0.03",
  }, cwd), /schema_version/);
});
