import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { parseCanonical402, parseStellarPaymentResponse, selectStellarExactRequirement, stellarAtomicAmount } from "@ackrate/core/x402";

const expected = { network: "stellar:testnet" as const, asset: TESTNET.nativeSac, payTo: Keypair.random().publicKey() };
const offer = { ...expected, scheme: "exact", amount: "10000000", maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } };
const challenge = { x402Version: 2, resource: { url: "https://merchant.example/data" }, accepts: [offer] };
const response = (value: typeof challenge) => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(value) } });

test("upstream canonical header preserves atomic units and selects matching offer", () => {
  const parsed = parseCanonical402(response({ ...challenge, accepts: [{ ...offer, network: "solana:mainnet" }, offer] }));
  assert.equal(selectStellarExactRequirement(parsed, expected).amount, "10000000");
  assert.equal(parsed.resource.url, challenge.resource.url);
  assert.throws(() => selectStellarExactRequirement(parsed, { ...expected, network: "stellar:pubnet" }), /no matching/);
});

test("canonical parsing rejects body-only v2, v1, malformed headers and malformed schemas", () => {
  assert.throws(() => parseCanonical402(new Response(JSON.stringify(challenge), { status: 402 })), /header/);
  for (const header of ["not base64!", Buffer.from('{}').toString('base64'), Buffer.from(JSON.stringify({ ...challenge, x402Version: 1 })).toString('base64')]) {
    assert.throws(() => parseCanonical402(new Response(null, { status: 402, headers: { "payment-required": header } })));
  }
});

test("Stellar selector rejects display units, zero, i128 overflow and missing sponsorship", () => {
  for (const amount of ["1.00", "0", "-1", "01", "1e7", String(1n << 127n)]) {
    assert.throws(() => stellarAtomicAmount(amount));
    assert.throws(() => selectStellarExactRequirement(parseCanonical402(response({ ...challenge, accepts: [{ ...offer, amount }] })), expected));
  }
  assert.throws(() => selectStellarExactRequirement(parseCanonical402(response({ ...challenge, accepts: [{ ...offer, extra: { areFeesSponsored: false } }] })), expected));
});

test("upstream settlement response decodes success and failure, rejects wrong network and invalid hash", () => {
  const settle = { success: true, transaction: "a".repeat(64), network: expected.network, payer: expected.payTo };
  const res = (value: typeof settle) => new Response(null, { headers: { "payment-response": encodePaymentResponseHeader(value) } });
  assert.deepEqual(parseStellarPaymentResponse(res(settle), expected.network), settle);
  assert.equal(parseStellarPaymentResponse(res({ ...settle, success: false, transaction: "" }), expected.network).success, false);
  assert.throws(() => parseStellarPaymentResponse(res(settle), "stellar:pubnet"), /invalid settlement/);
  assert.throws(() => parseStellarPaymentResponse(res({ ...settle, transaction: "fake" }), expected.network), /hash/);
});
