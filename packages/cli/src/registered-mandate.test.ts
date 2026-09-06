import assert from "node:assert/strict";
import test from "node:test";
import { ackrate } from "@ackrate/core";
import { TESTNET, type Mandate } from "@ackrate/stellar";
import { restoreRegisteredMandate } from "./registered-mandate.js";
import type { StoredMandate } from "./mandate-store.js";

function fixture() {
  const inputs = { user: "user", agent: "agent", merchant: "merchant", asset: "asset", maxAmount: "0.03", expiry: 1_800_000_000, nonce: "fixed" };
  const original = ackrate.createIntentMandate(inputs);
  const stored: StoredMandate = { version: 2, network: "mainnet", contractId: TESTNET.mandateRegistryId,
    inputs, id: "b".repeat(64), registerTx: "a".repeat(64), approveTx: "c".repeat(64) };
  const chain: Mandate = { user: inputs.user, agent: inputs.agent, merchant: inputs.merchant, asset: inputs.asset,
    max_amount: original.maxAmount, expiry: BigInt(inputs.expiry), spent: 0n, seq: 0, status: { tag: "Active", values: undefined }, vc_hash: original.idBuffer };
  return { stored, chain, original };
}

test("saved V2 registration id is restored instead of reusing its credential hash", async () => {
  const { stored, chain, original } = fixture();
  const restored = await restoreRegisteredMandate(stored, TESTNET, "unused", async (id) => {
    assert.equal(id.toString("hex"), stored.id);
    return chain;
  });
  assert.equal(restored.id, stored.id);
  assert.equal(restored.idBuffer.toString("hex"), stored.id);
  assert.equal(restored.credentialHash, original.id);
});

test("legacy equal credential and registry id still restores", async () => {
  const { stored, chain, original } = fixture();
  stored.id = original.id;
  assert.equal((await restoreRegisteredMandate(stored, TESTNET, "unused", async () => chain)).id, original.id);
});

test("stored id tampering or mismatched chain policy is refused before payment", async () => {
  const { stored, chain } = fixture();
  await assert.rejects(restoreRegisteredMandate({ ...stored, id: "bad" }, TESTNET, "unused", async () => {
    throw new Error("must not read invalid identifier");
  }), /identifier is invalid/);
  for (const changed of [
    { user: "other" }, { agent: "other" }, { merchant: "other" }, { asset: "other" },
    { max_amount: chain.max_amount + 1n }, { expiry: chain.expiry + 1n }, { vc_hash: Buffer.alloc(32, 9) },
  ]) {
    await assert.rejects(restoreRegisteredMandate(stored, TESTNET, "unused", async () => ({ ...chain, ...changed })), /does not match/);
  }
});
