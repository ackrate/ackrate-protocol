import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import {
  AP2_V01_INTENT_DATA_KEY,
  AP2_V01_SPEC_VERSION,
  InMemoryAp2ReplayStore,
  REAPP_AP2_V01_BINDING_VERSION,
  REAPP_AP2_V01_CREDENTIAL_VERSION,
  bindIntentMandate,
  createAp2ComplianceValidator,
  signAp2Mandate,
  signAp2V01Mandate,
  type BindIntentMandateInput,
} from "./index.js";

// Fixed seeds, not random keys: this file's job is to pin exact bytes.
const userKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
const agentKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x22));
const merchantKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x33));
const ASSET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function input(overrides: {
  intent?: Record<string, unknown>;
  stellar?: Record<string, unknown>;
} = {}): BindIntentMandateInput {
  return {
    intent: {
      user_cart_confirmation_required: false,
      natural_language_description: "Buy one research dataset",
      merchants: [merchantKey.publicKey()],
      intent_expiry: "2099-01-01T00:00:00Z",
      ...overrides.intent,
    },
    stellar: {
      user: userKey.publicKey(),
      agent: agentKey.publicKey(),
      asset: ASSET,
      maxAmount: "5.00",
      nonce: "reapp-ap2-v01-compat-vector-1",
      ...overrides.stellar,
    },
  } as BindIntentMandateInput;
}

/**
 * Produced by the ACTUAL published @reapp-sdk/ap2@0.3.0, not by this package:
 *
 *   npm install @reapp-sdk/ap2@0.3.0
 *   signAp2Mandate(<the `input()` above>, userKey)
 *
 * If this test fails, v0.1 minting has drifted off the published wire format
 * and every 0.3.x verifier in the field will reject what 0.4.x now signs.
 */
const PUBLISHED_0_3_0_CREDENTIAL = {
  credentialVersion: "reapp-ap2-credential/1",
  payload: {
    ap2SpecVersion: "0.1.0",
    ap2DataKey: "ap2.mandates.IntentMandate",
    bindingVersion: "reapp-ap2/1",
    intent: {
      user_cart_confirmation_required: false,
      natural_language_description: "Buy one research dataset",
      merchants: ["GAL4W6P3FNASB4VR5RS6IGMNNYELFDUBH7VQDZFEACBZXBPBQCAM5QIF"],
      skus: [],
      requires_refundability: false,
      intent_expiry: "2099-01-01T00:00:00Z",
    },
    stellar: {
      user: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
      agent: "GCQJVJPUPJTVTABP7FK7RXBNFIKKLSM5EO7JP6DECJ77SOBUKWSPB64N",
      asset: ASSET,
      maxAmount: "5.00",
      decimals: 7,
      nonce: "reapp-ap2-v01-compat-vector-1",
    },
  },
  mandateHash: "0ad9f867fa7effeeed6d564e71aebecdfa0f37c7d1076bd62d6fbde084d42d49",
  signature: {
    algorithm: "stellar-ed25519-sha256",
    value: "KYi9KvO0LRvru8J/AjuVXbTHmPMasaG6t+EjM7XpziZ3SBfZH2scBDPpKQ1q7odI8KD+i4sx1QkyuNv7aI/uBw==",
  },
} as const;

const PUBLISHED_0_3_0_INTENT_HASH =
  "fb19e23e2b93e2c62f1a0eec99a2c2802ffec667b23364f78c37df9f608a281d";

test("minted v0.1 credential is byte-identical to the published 0.3.0 vector", () => {
  const credential = signAp2V01Mandate(input(), userKey);
  assert.equal(
    JSON.stringify(credential),
    JSON.stringify(PUBLISHED_0_3_0_CREDENTIAL),
    "v0.1 minting drifted from the published 0.3.0 wire format",
  );
});

test("v0.1 binding reproduces the 0.3.0 intent hash and mandate id", () => {
  const binding = bindIntentMandate(input());
  assert.equal(binding.intentHash, PUBLISHED_0_3_0_INTENT_HASH);
  // Core does not expose the nonce it hashed, so the id is what proves the
  // `reapp-ap2/1:<intentHash>:<bindingNonce>` core nonce was rebuilt exactly.
  assert.equal(binding.mandate.id, PUBLISHED_0_3_0_CREDENTIAL.mandateHash);
  assert.equal(binding.bindingVersion, REAPP_AP2_V01_BINDING_VERSION);
  assert.equal(binding.bindingNonce, "reapp-ap2-v01-compat-vector-1");
  assert.equal(binding.mandate.maxAmount, 50_000_000n);
  assert.equal(binding.mandate.expiry, 4_070_908_800);
  assert.equal(binding.ap2SpecVersion, AP2_V01_SPEC_VERSION);
  assert.equal(binding.ap2DataKey, AP2_V01_INTENT_DATA_KEY);
});

test("a freshly minted v0.1 credential is admitted by this package's validator", async () => {
  const credential = signAp2V01Mandate(
    input({ stellar: { nonce: undefined } }),
    userKey,
  );
  const result = await createAp2ComplianceValidator({
    replayStore: new InMemoryAp2ReplayStore(),
    replayNamespace: "legacy-v01-roundtrip",
  }).validateAndConsume({
    credential,
    expectedUser: userKey.publicKey(),
    merchant: merchantKey.publicKey(),
    amount: "1.00",
  });
  assert.equal(result.credential.payload.ap2SpecVersion, AP2_V01_SPEC_VERSION);
  assert.equal(result.mandateHash, credential.mandateHash);
  assert.equal(result.amountStroops, 10_000_000n);
});

test("an omitted nonce is random, so two mints of the same intent differ", () => {
  const first = signAp2V01Mandate(input({ stellar: { nonce: undefined } }), userKey);
  const second = signAp2V01Mandate(input({ stellar: { nonce: undefined } }), userKey);
  assert.notEqual(first.payload.stellar.nonce, second.payload.stellar.nonce);
  assert.notEqual(first.mandateHash, second.mandateHash);
});

test("v0.1 and v0.2 mints of the same authorization produce different mandate ids", () => {
  const legacy = signAp2V01Mandate(input(), userKey);
  const current = signAp2Mandate({
    paymentMandate: {
      vct: "mandate.payment.open.1",
      constraints: [
        {
          type: "payment.allowed_payees",
          allowed: [{ id: merchantKey.publicKey(), name: "Dataset Co" }],
        },
        { type: "payment.amount_range", currency: "USD", max: 500 },
        { type: "payment.agent_recurrence", frequency: "ON_DEMAND" },
        { type: "payment.budget", max: 5, currency: "USD" },
        { type: "payment.execution_date", not_after: "2099-01-01T00:00:00Z" },
        { type: "payment.reference", conditional_transaction_id: "checkout-1" },
      ],
      cnf: {
        jwk: {
          kty: "OKP",
          crv: "Ed25519",
          x: Buffer.from(agentKey.rawPublicKey()).toString("base64url"),
        },
      },
      exp: 4_070_908_800,
    },
    stellar: {
      user: userKey.publicKey(),
      agent: agentKey.publicKey(),
      asset: ASSET,
      nonce: "reapp-ap2-v01-compat-vector-1",
    },
  }, userKey);

  // Same user, agent, merchant, asset, ceiling and expiry — but the binding
  // version and hashed mandate differ, so the two can never collide on-chain.
  assert.equal(legacy.payload.bindingVersion, "reapp-ap2/1");
  assert.equal(current.payload.bindingVersion, "reapp-ap2/2");
  assert.notEqual(legacy.mandateHash, current.mandateHash);
  assert.equal(legacy.credentialVersion, REAPP_AP2_V01_CREDENTIAL_VERSION);
  assert.equal(current.credentialVersion, "reapp-ap2-credential/2");
});

test("v0.1 minting keeps the legacy fail-closed rules", () => {
  const rejects = (
    overrides: Parameters<typeof input>[0],
    expected: RegExp,
  ): void => {
    assert.throws(() => signAp2V01Mandate(input(overrides), userKey), expected);
  };

  rejects({ intent: { user_cart_confirmation_required: true } }, /human|cart-confirmation/i);
  rejects({ intent: { requires_refundability: true } }, /refundability/);
  rejects({ intent: { skus: ["sku-1"] } }, /skus/);
  rejects(
    { intent: { merchants: [merchantKey.publicKey(), agentKey.publicKey()] } },
    /exactly one Stellar merchant/,
  );
  rejects({ intent: { intent_expiry: "2020-01-01T00:00:00Z" } }, /future Unix timestamp/);
  rejects({ intent: { intent_expiry: "2099-02-30T00:00:00Z" } }, /real calendar timestamp/);
  rejects({ intent: { intent_expiry: "2099-01-01T00:00:00" } }, /timezone/);
  rejects({ stellar: { asset: merchantKey.publicKey() } }, /contract address/);
  rejects({ stellar: { decimals: 39 } }, /0 through 38/);
  rejects({ intent: { unsupported_field: true } }, /unsupported field/);
  rejects({ stellar: { unsupported_field: true } }, /unsupported field/);
});

test("v0.1 minting refuses a signer that is not the mandate user", () => {
  assert.throws(
    () => signAp2V01Mandate(input(), agentKey),
    /signing key must match stellar\.user/,
  );
});

test("a v0.1 offset expiry normalizes to the same mandate as its UTC form", () => {
  const offset = bindIntentMandate(input({ intent: { intent_expiry: "2099-01-01T02:00:00+02:00" } }));
  assert.equal(offset.normalizedIntent.intent_expiry, "2099-01-01T00:00:00Z");
  assert.equal(offset.mandate.id, PUBLISHED_0_3_0_CREDENTIAL.mandateHash);
});
