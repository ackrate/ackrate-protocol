import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { test } from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import {
  ap2ScheduleHash,
  createAp2PoolParticipationAuthorization,
  signAp2PoolParticipationAuthorization,
} from "./authorization.js";
import {
  ACKRATE_CLOSED_POOL_PARTICIPATION_VCT,
  ACKRATE_OPEN_POOL_PARTICIPATION_VCT,
  verifyAckratePoolParticipation,
  type AckratePoolParticipationTerms,
} from "./pool.js";
import {
  computeSdHash,
  parseSdJwt,
  signCompactJws,
} from "./sd-jwt.js";
import { verifyAp2CheckoutAuthorization } from "./merchant.js";

const addresses = [
  "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
  "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U",
  "GDWUSKGGFDI4FRXK5EBTRECZSVQSSWJHHJOGH6JWG3AUMFFMQ435DIAG",
  "GDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HZDQP",
] as const;

function p256(): { privateKey: KeyObject; publicJwk: JsonWebKey } {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: pair.privateKey,
    publicJwk: pair.publicKey.export({ format: "jwk" }),
  };
}

function sdJwt(
  payload: Readonly<Record<string, unknown>>,
  key: KeyObject,
  typ?: string,
): string {
  return `${signCompactJws(payload, { alg: "ES256", key, ...(typ ? { typ } : {}) })}~`;
}

function chain(root: string, closed: string): string {
  return `${root.slice(0, -1)}~~${closed}`;
}

function fixture(options: { scheduleHash?: string; constraints?: readonly unknown[] } = {}) {
  const user = p256();
  const agentKey = p256();
  const now = 1_800_000_000;
  const terms: AckratePoolParticipationTerms = {
    registry: addresses[0],
    poolId: "10".repeat(32),
    mandateId: "11".repeat(32),
    agent: addresses[1],
    merchant: addresses[2],
    asset: addresses[3],
    maxAmount: 500n,
    scheduleHash: options.scheduleHash ?? ap2ScheduleHash([{ unitPrice: 125n, maxQty: 1n }]),
    captureWindowEnd: now + 300,
  };
  const wireTerms = {
    registry: terms.registry,
    pool_id: terms.poolId,
    mandate_id: terms.mandateId,
    agent: terms.agent,
    merchant: terms.merchant,
    asset: terms.asset,
    max_amount: terms.maxAmount.toString(),
    schedule_hash: terms.scheduleHash,
    capture_window_end: terms.captureWindowEnd,
  };
  const open = sdJwt({
    delegate_payload: [{
      vct: ACKRATE_OPEN_POOL_PARTICIPATION_VCT,
      ...wireTerms,
      constraints: options.constraints ?? [],
      cnf: { jwk: agentKey.publicJwk },
      exp: now + 600,
    }],
  }, user.privateKey);
  const closed = sdJwt({
    delegate_payload: [{
      vct: ACKRATE_CLOSED_POOL_PARTICIPATION_VCT,
      ...wireTerms,
    }],
    iat: now,
    aud: "merchant.example",
    nonce: "pool-nonce",
    sd_hash: computeSdHash(parseSdJwt(open)),
  }, agentKey.privateKey, "kb+sd-jwt");
  return {
    user,
    agentKey,
    now,
    terms,
    serialized: chain(open, closed),
  };
}

async function verifiedCheckout(value: ReturnType<typeof fixture>, merchantId = value.terms.merchant) {
  const merchantSigner = p256();
  const merchant = { id: merchantId, name: "Pool merchant" };
  const checkoutJwt = signCompactJws({
    id: "pool-checkout", merchant, status: "ready_for_complete", currency: "USD",
    line_items: [{ id: "pool-item", item: { id: "article", title: "Pool article", price: 125 },
      quantity: 1, totals: [] }], totals: [], links: [],
  }, { alg: "ES256", key: merchantSigner.privateKey });
  const checkoutHash = createHash("sha256").update(checkoutJwt, "ascii").digest("base64url");
  const open = sdJwt({ delegate_payload: [{
    vct: "mandate.checkout.open.1", constraints: [
      { type: "checkout.allowed_merchants", allowed: [merchant] },
    ], cnf: { jwk: value.agentKey.publicJwk }, exp: value.now + 600,
  }] }, value.user.privateKey);
  const closed = sdJwt({ delegate_payload: [{
    vct: "mandate.checkout.1", checkout_jwt: checkoutJwt, checkout_hash: checkoutHash,
  }], iat: value.now, aud: "merchant.example", nonce: "checkout-nonce",
  sd_hash: computeSdHash(parseSdJwt(open)) }, value.agentKey.privateKey, "kb+sd-jwt");
  return verifyAp2CheckoutAuthorization({
    checkoutMandateChain: chain(open, closed),
    resolveCheckoutRootKey: () => value.user.publicJwk,
    resolveCheckoutJwtKey: () => merchantSigner.publicJwk,
    expectedAudience: "merchant.example", expectedCheckoutNonce: "checkout-nonce",
    expectedMerchant: merchant, expectedCurrency: "USD", currentTime: value.now,
  });
}

test("verifies an exact Ackrate open/closed pool-participation chain", async () => {
  const value = fixture();
  const verified = await verifyAckratePoolParticipation({
    participationMandateChain: value.serialized,
    resolveRootKey: () => value.user.publicJwk,
    expectedAudience: "merchant.example",
    expectedNonce: "pool-nonce",
    expected: value.terms,
    currentTime: value.now,
  });
  assert.deepEqual(verified.terms, value.terms);
  assert.equal(verified.participationChain.payloads.length, 2);
});

test("schedule hash matches the Composite contract vector", () => {
  assert.equal(
    ap2ScheduleHash([{ unitPrice: 125n, maxQty: 1n }]),
    "9844521ea8769ebb502665203fd97c617f19e17c6c2d5ba90cbbd79beddd8251",
  );
});

test("pool participation fails closed on unknown constraints and changed terms", async () => {
  const unknown = fixture({ constraints: [{ type: "vendor.private", allowed: true }] });
  await assert.rejects(
    verifyAckratePoolParticipation({
      participationMandateChain: unknown.serialized,
      resolveRootKey: () => unknown.user.publicJwk,
      expectedAudience: "merchant.example",
      expectedNonce: "pool-nonce",
      expected: unknown.terms,
      currentTime: unknown.now,
    }),
    /unknown pool-participation constraints fail closed/,
  );

  const changed = fixture();
  await assert.rejects(
    verifyAckratePoolParticipation({
      participationMandateChain: changed.serialized,
      resolveRootKey: () => changed.user.publicJwk,
      expectedAudience: "merchant.example",
      expectedNonce: "pool-nonce",
      expected: { ...changed.terms, scheduleHash: "ff".repeat(32) },
      currentTime: changed.now,
    }),
    /changes the expected pool terms/,
  );
});

test("builds and signs the contract participation authorization from verified evidence", async () => {
  const value = fixture();
  const participation = await verifyAckratePoolParticipation({
    participationMandateChain: value.serialized,
    resolveRootKey: () => value.user.publicJwk,
    expectedAudience: "merchant.example",
    expectedNonce: "pool-nonce",
    expected: value.terms,
    currentTime: value.now,
  });
  const checkout = await verifiedCheckout(value);
  const verifier = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
  const authorization = createAp2PoolParticipationAuthorization({
    checkout,
    participation,
    networkPassphrase: Networks.TESTNET,
    verifier,
    notBefore: value.now,
    expiresAt: value.terms.captureWindowEnd + 1,
    nonce: "17".repeat(32),
  });
  const signed = signAp2PoolParticipationAuthorization(authorization, verifier);

  assert.equal(authorization.scheduleHash, value.terms.scheduleHash);
  assert.equal(authorization.agent, value.terms.agent);
  assert(verifier.verify(
    Buffer.from(signed.authorizationId, "hex"),
    Buffer.from(signed.signature, "hex"),
  ));
});

test("pool authorization rejects a missing or mismatched verified checkout merchant", async () => {
  const value = fixture();
  const participation = await verifyAckratePoolParticipation({
    participationMandateChain: value.serialized,
    resolveRootKey: () => value.user.publicJwk,
    expectedAudience: "merchant.example", expectedNonce: "pool-nonce",
    expected: value.terms, currentTime: value.now,
  });
  const options = { participation, networkPassphrase: Networks.TESTNET,
    verifier: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)), notBefore: value.now,
    expiresAt: value.terms.captureWindowEnd + 1, nonce: "17".repeat(32) };
  const checkout = await verifiedCheckout(value);
  assert.throws(() => createAp2PoolParticipationAuthorization({ ...options,
    checkout: { ...checkout, checkout: { ...checkout.checkout, merchant: undefined } },
  }), /checkout must identify its verified merchant/);
  for (const merchant of [addresses[0], "opaque-merchant-id"]) {
    const mismatched = await verifiedCheckout(value, merchant);
    assert.equal(mismatched.checkout.merchant?.id, merchant);
    assert.throws(() => createAp2PoolParticipationAuthorization({ ...options, checkout: mismatched }),
      /checkout merchant must equal the participation merchant/);
  }
});
