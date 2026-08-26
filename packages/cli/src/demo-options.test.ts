import assert from "node:assert/strict";
import test from "node:test";
import { MAINNET_DEMO_URL, demoNetwork } from "./commands/demo.js";

test("demo network defaults to testnet and accepts explicit mainnet", () => {
  assert.equal(demoNetwork(undefined), "testnet");
  assert.equal(demoNetwork("testnet"), "testnet");
  assert.equal(demoNetwork("mainnet"), "mainnet");
});

test("demo network rejects unknown values without falling back", () => {
  assert.throws(() => demoNetwork("public"), /testnet or mainnet/);
});

test("mainnet demo entrypoint is the HTTPS Freighter flow", () => {
  const url = new URL(MAINNET_DEMO_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "reapp.live");
  assert.equal(url.pathname, "/wallet");
});
