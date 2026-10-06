import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import * as current from "../index.js";
import * as currentJwt from "../sd-jwt.js";
import * as v02 from "./index.js";

test("v0.1 compatibility delegates preserve current signatures and replay identities", async () => {
  const user = Keypair.random();
  const merchant = Keypair.random().publicKey();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const input = {
    intent: { user_cart_confirmation_required: false, natural_language_description: "Read one source",
      merchants: [merchant], intent_expiry: new Date(expiry * 1000).toISOString().replace(".000Z", "Z") },
    stellar: { user: user.publicKey(), agent: Keypair.random().publicKey(),
      asset: StrKey.encodeContract(Buffer.alloc(32, 7)), maxAmount: "1.00", nonce: "compatibility-vector" },
  };
  const credential = current.signAp2Mandate(input, user);
  assert.deepEqual(v02.signAp2V01Mandate(input, user), credential);
  assert.equal(v02.InMemoryAp2ReplayStore, current.InMemoryAp2ReplayStore);
  assert.equal(v02.verifyDelegateSdJwtChain, currentJwt.verifyDelegateSdJwtChain);
  assert.equal(v02.signCompactJws, currentJwt.signCompactJws);
  const replayStore = new current.InMemoryAp2ReplayStore();
  const options = { replayStore, replayNamespace: "version-compatibility" };
  const request = { credential, expectedUser: user.publicKey(), merchant, amount: "0.01" };
  const admitted = await current.createAp2ComplianceValidator(options).validateAndConsume(request);
  assert.equal(admitted.mandateHash, credential.mandateHash);
  await assert.rejects(v02.createAp2ComplianceValidator(options).validateAndConsume(request),
    (error: unknown) => error instanceof v02.Ap2ValidationError && error.code === "REPLAYED");
});

test("the unchanged default validator rejects a v0.2 credential without consuming replay state", async () => {
  const user = Keypair.random();
  const agent = Keypair.random().publicKey();
  const merchant = Keypair.random().publicKey();
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const checkoutReference = "checkout-compatibility";
  const credential = v02.signAp2Mandate({
    paymentMandate: { vct: v02.AP2_OPEN_PAYMENT_VCT, exp: expiry,
      cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: Buffer.from(StrKey.decodeEd25519PublicKey(agent)).toString("base64url") } },
      constraints: [
        { type: "payment.allowed_payees", allowed: [{ id: merchant, name: "Source merchant" }] },
        { type: "payment.amount_range", currency: "USD", max: 100 },
        { type: "payment.agent_recurrence", frequency: "ON_DEMAND" },
        { type: "payment.budget", currency: "USD", max: 1 },
        { type: "payment.execution_date", not_after: new Date(expiry * 1000).toISOString().replace(".000Z", "Z") },
        { type: "payment.reference", conditional_transaction_id: checkoutReference },
      ] },
    stellar: { user: user.publicKey(), agent, asset: StrKey.encodeContract(Buffer.alloc(32, 8)), nonce: "explicit-v02" },
  }, user);
  const replayStore = new current.InMemoryAp2ReplayStore();
  const options = { replayStore, replayNamespace: "explicit-v02" };
  const request = { credential, expectedUser: user.publicKey(), merchant, amount: "0.01", checkoutReference };
  await assert.rejects(current.createAp2ComplianceValidator(options).validateAndConsume(request));
  const admitted = await v02.createAp2ComplianceValidator(options).validateAndConsume(request);
  assert.equal(admitted.mandateHash, credential.mandateHash);
});
