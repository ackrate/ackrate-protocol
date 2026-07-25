import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { test } from "node:test";
import {
  AP2_PAYABLE_CHECKOUT_STATUSES,
  Ap2MerchantVerificationError,
  signAp2CheckoutReceipt,
  signAp2PaymentReceipt,
  verifyAp2CheckoutAuthorization,
  verifyAp2MerchantAuthorization,
} from "./merchant.js";
import {
  computeSdHash,
  parseSdJwt,
  signCompactJws,
  verifyCompactJws,
} from "./sd-jwt.js";

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

function fixture(overrides: {
  amount?: number;
  paymentConstraints?: readonly Record<string, unknown>[];
  checkoutStatus?: string;
  closedPaymentOverrides?: Readonly<Record<string, unknown>>;
} = {}) {
  const user = p256();
  const agent = p256();
  const merchantSigner = p256();
  const receiptSigner = p256();
  const now = 1_800_000_000;
  const merchant = {
    id: "stellar:GCMERCHANT",
    name: "Research Merchant",
    website: "https://merchant.example",
  };
  const amount = overrides.amount ?? 2_500;
  const checkout = {
    id: "checkout-1",
    merchant,
    line_items: [{
      id: "line-1",
      item: { id: "dataset-1", title: "Research dataset", price: amount },
      quantity: 1,
      totals: [],
    }],
    status: overrides.checkoutStatus ?? "ready_for_complete",
    currency: "USD",
    totals: [],
    links: [],
  };
  const checkoutJwt = signCompactJws(checkout, {
    alg: "ES256",
    key: merchantSigner.privateKey,
    kid: "merchant-checkout-1",
    typ: "JWT",
  });
  const checkoutJwtHash = createHash("sha256").update(checkoutJwt, "ascii").digest("base64url");

  const checkoutRoot = sdJwt({
    delegate_payload: [{
      vct: "mandate.checkout.open.1",
      constraints: [
        { type: "checkout.allowed_merchants", allowed: [merchant] },
        {
          type: "checkout.line_items",
          items: [{
            id: "dataset",
            acceptable_items: [{ id: "dataset-1", title: "Research dataset" }],
            quantity: 1,
          }],
        },
      ],
      cnf: { jwk: agent.publicJwk },
      exp: now + 600,
    }],
  }, user.privateKey);
  const checkoutClosed = sdJwt({
    delegate_payload: [{
      vct: "mandate.checkout.1",
      checkout_jwt: checkoutJwt,
      checkout_hash: checkoutJwtHash,
    }],
    iat: now,
    aud: "merchant.example",
    nonce: "checkout-nonce",
    sd_hash: computeSdHash(parseSdJwt(checkoutRoot)),
  }, agent.privateKey, "kb+sd-jwt");
  const checkoutMandateChain = chain(checkoutRoot, checkoutClosed);
  const openCheckoutHash = computeSdHash(parseSdJwt(checkoutRoot));

  const paymentConstraints = overrides.paymentConstraints ?? [
    { type: "payment.allowed_payees", allowed: [merchant] },
    { type: "payment.amount_range", currency: "USD", min: 1, max: 5_000 },
    { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 5 },
    { type: "payment.budget", currency: "USD", max: 100 },
    { type: "payment.reference", conditional_transaction_id: openCheckoutHash },
  ];
  const paymentRoot = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.open.1",
      constraints: paymentConstraints,
      cnf: { jwk: agent.publicJwk },
      exp: now + 600,
    }],
  }, user.privateKey);
  const paymentClosed = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.1",
      transaction_id: checkoutJwtHash,
      payee: merchant,
      payment_amount: { amount, currency: "USD" },
      payment_instrument: { id: "stellar-usdc", type: "push" },
      ...(overrides.closedPaymentOverrides ?? {}),
    }],
    iat: now,
    aud: "merchant.example",
    nonce: "payment-nonce",
    sd_hash: computeSdHash(parseSdJwt(paymentRoot)),
  }, agent.privateKey, "kb+sd-jwt");

  return {
    user,
    merchantSigner,
    receiptSigner,
    now,
    merchant,
    amount,
    checkoutRoot,
    checkoutClosed,
    checkoutMandateChain,
    paymentMandateChain: chain(paymentRoot, paymentClosed),
  };
}

/** The standard happy-path call, with `overrides` applied on top. */
function verify(
  f: ReturnType<typeof fixture>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return verifyAp2MerchantAuthorization({
    checkoutMandateChain: f.checkoutMandateChain,
    paymentMandateChain: f.paymentMandateChain,
    resolveCheckoutRootKey: () => f.user.publicJwk,
    resolvePaymentRootKey: () => f.user.publicJwk,
    resolveCheckoutJwtKey: () => f.merchantSigner.publicJwk,
    expectedAudience: "merchant.example",
    expectedCheckoutNonce: "checkout-nonce",
    expectedPaymentNonce: "payment-nonce",
    expectedMerchant: f.merchant,
    expectedAmountMinor: f.amount,
    expectedCurrency: "USD",
    usage: { totalAmountMinor: 0, totalUses: 0 },
    currentTime: f.now,
    ...overrides,
  } as Parameters<typeof verifyAp2MerchantAuthorization>[0]);
}

function code(expected: string) {
  return (error: unknown) =>
    error instanceof Ap2MerchantVerificationError && error.code === expected;
}

test("verifies linked AP2 v0.2 Checkout and Payment chains", async () => {
  const f = fixture();
  const verified = await verifyAp2MerchantAuthorization({
    checkoutMandateChain: f.checkoutMandateChain,
    paymentMandateChain: f.paymentMandateChain,
    resolveCheckoutRootKey: () => f.user.publicJwk,
    resolvePaymentRootKey: () => f.user.publicJwk,
    resolveCheckoutJwtKey: () => f.merchantSigner.publicJwk,
    expectedAudience: "merchant.example",
    expectedCheckoutNonce: "checkout-nonce",
    expectedPaymentNonce: "payment-nonce",
    expectedMerchant: f.merchant,
    expectedAmountMinor: f.amount,
    expectedCurrency: "USD",
    usage: { totalAmountMinor: 1_000, totalUses: 1 },
    currentTime: f.now,
  });

  assert.equal(verified.checkout.id, "checkout-1");
  assert.equal(verified.closedPayment.payment_amount.amount, 2_500);
  assert.equal(verified.checkoutJwtHash, verified.closedPayment.transaction_id);
  assert.equal(verified.openCheckoutHash, verified.checkoutChain.rootSdHash);
});

test("fails closed on unknown constraints and trusted amount mismatches", async () => {
  const unknown = fixture({
    paymentConstraints: [{ type: "merchant.private_constraint", value: true }],
  });
  await assert.rejects(
    verifyAp2MerchantAuthorization({
      checkoutMandateChain: unknown.checkoutMandateChain,
      paymentMandateChain: unknown.paymentMandateChain,
      resolveCheckoutRootKey: () => unknown.user.publicJwk,
      resolvePaymentRootKey: () => unknown.user.publicJwk,
      resolveCheckoutJwtKey: () => unknown.merchantSigner.publicJwk,
      expectedAudience: "merchant.example",
      expectedCheckoutNonce: "checkout-nonce",
      expectedPaymentNonce: "payment-nonce",
      expectedMerchant: unknown.merchant,
      expectedAmountMinor: unknown.amount,
      expectedCurrency: "USD",
      currentTime: unknown.now,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "Ap2MerchantVerificationError" &&
      /unsupported Payment constraint/.test(error.message),
  );

  const normal = fixture();
  await assert.rejects(
    verifyAp2MerchantAuthorization({
      checkoutMandateChain: normal.checkoutMandateChain,
      paymentMandateChain: normal.paymentMandateChain,
      resolveCheckoutRootKey: () => normal.user.publicJwk,
      resolvePaymentRootKey: () => normal.user.publicJwk,
      resolveCheckoutJwtKey: () => normal.merchantSigner.publicJwk,
      expectedAudience: "merchant.example",
      expectedCheckoutNonce: "checkout-nonce",
      expectedPaymentNonce: "payment-nonce",
      expectedMerchant: normal.merchant,
      expectedAmountMinor: normal.amount + 1,
      expectedCurrency: "USD",
      usage: { totalAmountMinor: 0, totalUses: 0 },
      currentTime: normal.now,
    }),
    /does not match the pending Stellar capture/,
  );
});

test("a chain with no open mandate cannot satisfy audience, nonce or constraints", async () => {
  const f = fixture();

  // The closed hop alone: correctly signed, but it delegates from nothing, so
  // there is no open mandate to evaluate and no terminal hop to bind.
  await assert.rejects(
    verifyAp2CheckoutAuthorization({
      checkoutMandateChain: f.checkoutClosed,
      resolveCheckoutRootKey: () => f.user.publicJwk,
      resolveCheckoutJwtKey: () => f.merchantSigner.publicJwk,
      expectedAudience: "merchant.example",
      expectedCheckoutNonce: "checkout-nonce",
      expectedMerchant: f.merchant,
      expectedCurrency: "USD",
      currentTime: f.now,
    }),
    code("CHAIN_INVALID"),
  );
});

test("a stale audience or nonce is rejected on the terminal hop", async () => {
  const f = fixture();
  await assert.rejects(
    verify(f, { expectedCheckoutNonce: "a-different-challenge" }),
    code("CHAIN_INVALID"),
  );
  await assert.rejects(
    verify(f, { expectedAudience: "another.merchant.example" }),
    code("CHAIN_INVALID"),
  );
});

test("an omitted execution_date cannot escape a signed execution window", async () => {
  // The user signed "not before 2099"; the closed mandate simply says nothing.
  // Silence must not read as permission.
  const f = fixture({
    paymentConstraints: [
      { type: "payment.execution_date", not_before: "2099-01-01T00:00:00Z" },
    ],
  });
  await assert.rejects(verify(f), code("PAYMENT_CONSTRAINT_FAILED"));

  // The same mandate inside its window is accepted.
  const open = fixture({
    paymentConstraints: [
      { type: "payment.execution_date", not_after: "2099-01-01T00:00:00Z" },
    ],
  });
  assert.equal((await verify(open)).closedPayment.payment_amount.amount, open.amount);
});

test("a declared execution_date is still held to the window", async () => {
  const f = fixture({
    paymentConstraints: [
      { type: "payment.execution_date", not_after: "2020-01-01T00:00:00Z" },
    ],
    closedPaymentOverrides: { execution_date: "2026-07-24T00:00:00Z" },
  });
  await assert.rejects(verify(f), code("PAYMENT_CONSTRAINT_FAILED"));
});

test("a canceled or unfinished checkout cannot back a capture", async () => {
  for (const status of ["canceled", "incomplete", "requires_escalation"]) {
    await assert.rejects(
      verify(fixture({ checkoutStatus: status })),
      code("CHECKOUT_NOT_PAYABLE"),
      `status ${status} must not be payable`,
    );
  }
  for (const status of AP2_PAYABLE_CHECKOUT_STATUSES) {
    const verified = await verify(fixture({ checkoutStatus: status }));
    assert.equal(verified.checkout.status, status);
  }
});

test("a caller may widen the payable statuses but not invent one", async () => {
  const verified = await verify(fixture({ checkoutStatus: "incomplete" }), {
    acceptedCheckoutStatuses: ["incomplete"],
  });
  assert.equal(verified.checkout.status, "incomplete");

  await assert.rejects(
    verify(fixture(), { acceptedCheckoutStatuses: ["not_a_real_status"] }),
    code("SCHEMA_INVALID"),
  );
  await assert.rejects(verify(fixture(), { acceptedCheckoutStatuses: [] }), code("SCHEMA_INVALID"));
});

test("creates verifiable AP2 success and rejection receipts", () => {
  const f = fixture();
  const checkoutReceipt = signAp2CheckoutReceipt({
    status: "Success",
    iss: "https://merchant.example",
    iat: f.now,
    reference: "closed-checkout-hash",
    order_id: "order-1",
  }, {
    alg: "ES256",
    key: f.receiptSigner.privateKey,
    kid: "receipt-key-1",
    typ: "JWT",
  });
  const paymentReceipt = signAp2PaymentReceipt({
    status: "Error",
    iss: "https://merchant.example",
    iat: f.now,
    reference: "closed-payment-hash",
    payment_id: "payment-1",
    error: "PAYMENT_FAILED",
    error_description: "The on-chain capture reverted.",
  }, {
    alg: "ES256",
    key: f.receiptSigner.privateKey,
    kid: "receipt-key-1",
    typ: "JWT",
  });

  assert.equal(
    verifyCompactJws(checkoutReceipt, f.receiptSigner.publicJwk).payload.order_id,
    "order-1",
  );
  assert.equal(
    verifyCompactJws(paymentReceipt, f.receiptSigner.publicJwk).payload.status,
    "Error",
  );
});
