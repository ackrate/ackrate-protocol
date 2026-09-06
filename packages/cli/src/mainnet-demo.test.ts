import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
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

test("mainnet demo requires the verified deployment manifest after confirmation", async () => {
  await isolatedHome();
  await assert.rejects(
    runDemo("research-agent", { network: "mainnet", confirmRealUsdc: true }),
    /--manifest/,
  );
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
