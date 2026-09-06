import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { MAINNET, MAINNET_DEPLOYMENT_MANIFEST, TESTNET } from "@ackrate/stellar";
import {
  CONFIG_FILE,
  createMainnetConfig,
  defaultConfig,
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

const mainnetActors = () => ({
  userSigner: "user-identity",
  agentSigner: "agent-identity",
  merchant: Keypair.random().publicKey(),
  unlockPrice: "0.01",
  budget: "0.03",
});

test("default config selects the official Mainnet contract without a deployment file", async () => {
  const cwd = await root();
  const config = defaultConfig(mainnetActors(), cwd);
  assert.equal(config.network, "mainnet");
  assert.equal(config.contractId, "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR");
  assert.equal(config.manifestPath, undefined);
  assert.equal(config.manifestSha256, undefined);
  saveConfig(config, cwd);
  const loaded = loadConfig(cwd);
  assert.equal(loaded.contractId, MAINNET.mandateRegistryId);
  assert.equal(networkConfig(loaded, cwd), MAINNET);
  assert.notEqual(networkConfig(loaded, cwd).mandateRegistryId, TESTNET.mandateRegistryId);
  assert.equal(loaded.explorer, "https://stellar.expert/explorer/public");
});

test("Mainnet config rejects a substituted contract even when passed directly", async () => {
  const cwd = await root();
  const config = { ...defaultConfig(mainnetActors(), cwd), contractId: TESTNET.mandateRegistryId };
  assert.throws(() => saveConfig(config, cwd), /must match the official registry/);
  assert.throws(() => networkConfig(config, cwd), /must match the official registry/);
});

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
    contractId: MAINNET.mandateRegistryId,
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

test("optional Mainnet manifest is pinned to both file contents and official deployment", async () => {
  const cwd = await root();
  const path = join(cwd, "manifest.json");
  await writeFile(path, JSON.stringify(MAINNET_DEPLOYMENT_MANIFEST));
  const config = createMainnetConfig({ ...mainnetActors(), manifestPath: "manifest.json" }, cwd);
  assert.equal(config.manifestSha256, sha256File(path));
  assert.equal(networkConfig(config, cwd).mandateRegistryId, MAINNET.mandateRegistryId);
  const changed = structuredClone(MAINNET_DEPLOYMENT_MANIFEST);
  const changedDeployment = changed.deployment as { registry_contract_id: string };
  changedDeployment.registry_contract_id = TESTNET.mandateRegistryId;
  await writeFile(path, JSON.stringify(changed));
  assert.throws(() => createMainnetConfig({ ...mainnetActors(), manifestPath: "manifest.json" }, cwd), /published Mainnet deployment/);
  // Even replacing the recorded file hash cannot select an alternate contract.
  assert.throws(() => networkConfig({ ...config, manifestSha256: sha256File(path) }, cwd), /published Mainnet deployment/);
});

test("incomplete optional manifest pins fail closed", async () => {
  const cwd = await root();
  const config = defaultConfig(mainnetActors(), cwd);
  assert.throws(() => saveConfig({ ...config, manifestPath: "manifest.json" }, cwd), /missing or unknown fields/);
  assert.throws(() => saveConfig({ ...config, manifestSha256: "a".repeat(64) }, cwd), /missing or unknown fields/);
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
