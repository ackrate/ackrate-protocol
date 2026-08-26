import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { runDemo } from "./commands/demo.js";

const roots: string[] = [];
const priorHome = process.env.ACKRATE_HOME;

afterEach(async () => {
  if (priorHome === undefined) delete process.env.ACKRATE_HOME;
  else process.env.ACKRATE_HOME = priorHome;
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
