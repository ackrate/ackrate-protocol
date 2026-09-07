import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { MAINNET, MAINNET_DEPLOYMENT_MANIFEST, TESTNET } from "@ackrate/stellar";
import { build } from "esbuild";
import { runDemo, secretManagerAgentSigner } from "./commands/demo.js";

const roots: string[] = [];
const priorHome = process.env.ACKRATE_HOME;
const priorSecret = process.env.ACKRATE_TEST_AGENT_SECRET;

afterEach(async () => {
  if (priorHome === undefined) delete process.env.ACKRATE_HOME;
  else process.env.ACKRATE_HOME = priorHome;
  if (priorSecret === undefined) delete process.env.ACKRATE_TEST_AGENT_SECRET;
  else process.env.ACKRATE_TEST_AGENT_SECRET = priorSecret;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function isolatedHome(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ackrate-mainnet-demo-"));
  roots.push(root);
  process.env.ACKRATE_HOME = root;
}

test("mainnet demo fails before reading configuration without real-USDC confirmation", async () => {
  await isolatedHome();
  await assert.rejects(
    runDemo("research-agent", { network: "mainnet" }),
    /--confirm-real-usdc/,
  );
});

test("default demo is Mainnet and requires real-USDC confirmation before selecting signers", async () => {
  await isolatedHome();
  await assert.rejects(runDemo("research-agent"), /--confirm-real-usdc/);
});

test("explicit setup resume still needs real-USDC confirmation and rejects Testnet or malformed hashes", async () => {
  await isolatedHome();
  await assert.rejects(runDemo("research-agent", { resumeSetupRegistration: "a".repeat(64) }), /--confirm-real-usdc/);
  await assert.rejects(runDemo("research-agent", { network: "testnet", resumeSetupRegistration: "a".repeat(64), confirmRealUsdc: true }), /requires Mainnet/);
  await assert.rejects(runDemo("research-agent", { resumeSetupRegistration: "not-a-hash", confirmRealUsdc: true }), /exact lowercase transaction hash/);
});

test("mainnet demo uses bundled deployment and asks for public actors, not a manifest", async () => {
  await isolatedHome();
  await assert.rejects(
    runDemo("research-agent", { network: "mainnet", confirmRealUsdc: true }),
    /--merchant/,
  );
});

test("demo rejects an alternate Mainnet contract before selecting signers", async () => {
  await isolatedHome();
  const manifest = structuredClone(MAINNET_DEPLOYMENT_MANIFEST);
  (manifest.deployment as { registry_contract_id: string }).registry_contract_id = TESTNET.mandateRegistryId;
  const path = join(process.env.ACKRATE_HOME!, "manifest.json");
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(runDemo("research-agent", { confirmRealUsdc: true, manifest: path }), /published Mainnet deployment/);
});

test("unknown network fails closed", async () => {
  await isolatedHome();
  await assert.rejects(
    runDemo("research-agent", { network: "publicnet" }),
    /testnet or mainnet/,
  );
});

test("bundled CLI help, demo listing, and unconfirmed Mainnet never bootstrap the standalone merchant", async () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  // Keep the temporary bundle beneath the repository so its one external
  // dependency resolves exactly as it does in an installed CLI package.
  const bundleRoot = await mkdtemp(join(repoRoot, ".cli-bundle-smoke-"));
  roots.push(bundleRoot);
  const bundlePath = join(bundleRoot, "ackrate-cli.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    absWorkingDir: repoRoot,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@stellar/stellar-sdk"],
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
    outfile: bundlePath,
    logLevel: "silent",
  });
  const env = {
    PATH: process.env.PATH ?? "",
    ACKRATE_HOME: join(bundleRoot, "state"),
    // A standalone bootstrap would reject this marker before opening a server.
    ACKRATE_NETWORK: "standalone-must-not-run",
  };
  for (const args of [["--help"], ["demo"]]) {
    const result = spawnSync(process.execPath, [bundlePath, ...args], {
      cwd: repoRoot, env, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "", "CLI metadata commands must not invoke merchant configuration");
    assert.doesNotMatch(result.stdout, /fulfillment-agent listening/);
    assert.match(result.stdout, args[0] === "--help" ? /Usage: ackrate/ : /research-agent/);
  }
  const rejected = spawnSync(process.execPath, [bundlePath, "demo", "research-agent", "--network", "mainnet"], {
    cwd: repoRoot, env, encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /--confirm-real-usdc/);
  assert.doesNotMatch(`${rejected.stdout}\n${rejected.stderr}`, /ACKRATE_NETWORK must|fulfillment-agent listening|ACKRATE_CHALLENGE_SECRET/);
  const defaultRejected = spawnSync(process.execPath, [bundlePath, "demo", "research-agent"], {
    cwd: repoRoot, env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(defaultRejected.status, 1);
  assert.match(defaultRejected.stderr, /--confirm-real-usdc/);
  assert.doesNotMatch(`${defaultRejected.stdout}\n${defaultRejected.stderr}`, /friendbot|funding three|fulfillment-agent listening/);

  const init = spawnSync(process.execPath, [bundlePath, "init",
    "--user-signer", "user", "--agent-signer", "agent", "--merchant", Keypair.random().publicKey(),
    "--price", "0.01", "--budget", "0.03"], {
    cwd: bundleRoot, env, encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(init.error);
  assert.equal(init.status, 0, init.stderr);
  const config = JSON.parse(await readFile(join(bundleRoot, "ackrate.config.json"), "utf8"));
  assert.equal(config.network, "mainnet");
  assert.equal(config.contractId, MAINNET.mandateRegistryId);
  assert.equal(config.manifestPath, undefined);
  assert.match(init.stdout, new RegExp(`https://stellar.expert/explorer/public/contract/${MAINNET.mandateRegistryId}`));
  const unconfirmedMandate = spawnSync(process.execPath, [bundlePath, "mandate", "create"], {
    cwd: bundleRoot, env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(unconfirmedMandate.status, 1);
  assert.match(unconfirmedMandate.stderr, /--confirm-real-usdc/);
  // The guard must run before even decoding the stored mandate or invoking an
  // external signer. An unreadable-as-mandate marker makes that order observable.
  await mkdir(env.ACKRATE_HOME, { recursive: true });
  await writeFile(join(env.ACKRATE_HOME, "mandate.json"), "{}\n");
  const unconfirmedPayment = spawnSync(process.execPath, [bundlePath, "pay"], {
    cwd: bundleRoot, env, encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(unconfirmedPayment.error);
  assert.equal(unconfirmedPayment.status, 1);
  assert.match(unconfirmedPayment.stderr, /--confirm-real-usdc/);
});

test("bound-v2 Mainnet signer is accepted only from the named secret-manager environment variable", () => {
  const agent = Keypair.random();
  delete process.env.ACKRATE_TEST_AGENT_SECRET;
  assert.throws(
    () => secretManagerAgentSigner("ACKRATE_TEST_AGENT_SECRET", agent.publicKey(), TESTNET),
    /secret manager did not supply/,
  );
  process.env.ACKRATE_TEST_AGENT_SECRET = agent.secret();
  assert.equal(
    secretManagerAgentSigner("ACKRATE_TEST_AGENT_SECRET", agent.publicKey(), TESTNET).publicKey,
    agent.publicKey(),
  );
  assert.throws(
    () => secretManagerAgentSigner("ACKRATE_TEST_AGENT_SECRET", Keypair.random().publicKey(), TESTNET),
    /does not match/,
  );
  assert.throws(
    () => secretManagerAgentSigner("not-valid", agent.publicKey(), TESTNET),
    /environment-variable name/,
  );
});
