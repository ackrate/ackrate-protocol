import assert from "node:assert/strict";
import test from "node:test";
import { assertMandateBindings, mandateView } from "../lib/mandate-state";

const contractMandate = {
  user: "GUSER",
  agent: "GAGENT",
  merchant: "GMERCHANT",
  asset: "CASSET",
  max_amount: 30_000_000n,
  spent: 10_000_000n,
  expiry: 2_000n,
  seq: 1,
  status: { tag: "Active" as const, values: undefined },
  vc_hash: Buffer.alloc(32),
};

test("mandate view derives remaining funds from current contract state", () => {
  const view = mandateView("a".repeat(64), contractMandate);
  assert.equal(view.remaining, "20000000");
  assert.equal(view.status, "Active");
});

test("every configured identity, asset, status, and expiry must match", () => {
  const view = mandateView("a".repeat(64), contractMandate);
  assert.doesNotThrow(() => assertMandateBindings(view, {
    user: "GUSER", agent: "GAGENT", merchant: "GMERCHANT", asset: "CASSET",
  }, 1_999));
  assert.throws(() => assertMandateBindings(view, {
    user: "GUSER", agent: "GROGUE", merchant: "GMERCHANT", asset: "CASSET",
  }, 1_999), /agent/);
  assert.throws(() => assertMandateBindings(view, {
    user: "GUSER", agent: "GAGENT", merchant: "GMERCHANT", asset: "CASSET",
  }, 2_000), /expired/);
});

test("invalid accounting returned from a contract read is rejected", () => {
  assert.throws(() => mandateView("a".repeat(64), { ...contractMandate, spent: 40_000_000n }), /accounting invariant/);
});
