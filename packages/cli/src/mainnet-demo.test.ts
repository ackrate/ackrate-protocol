import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
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
