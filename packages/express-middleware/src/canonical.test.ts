import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { parseCanonical402, parseStellarPaymentResponse } from "@ackrate/core/x402";
import { canonicalStellarPaymentMiddleware, type FacilitatorClient } from "@ackrate/express-middleware/canonical";

// Transport interoperability fixture, not an on-chain/facilitator implementation test.
test("canonical Stellar HTTP round trip gates delivery on verify and settle", async () => {
  let valid = true;
  let settled = true;
  let verifies = 0;
  let settles = 0;
  const payTo = Keypair.random().publicKey();
  const network = "stellar:testnet" as const;
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network, extra: { areFeesSponsored: true } }], extensions: [], signers: {} }),
    verify: async (payload, requirement) => {
      verifies++;
      assert.deepEqual(payload.accepted, requirement);
      return { isValid: valid, payer: payTo, ...(valid ? {} : { invalidReason: "fixture_invalid" }) };
    },
    settle: async () => {
      settles++;
      return { success: settled, network, payer: payTo, transaction: settled ? "a".repeat(64) : "", ...(settled ? {} : { errorReason: "fixture_failed" }) };
    },
  };
  const app = express();
  app.use(canonicalStellarPaymentMiddleware({ "GET /data": { accepts: [{ scheme: "exact", network, payTo, price: { amount: "10000000", asset: TESTNET.nativeSac } }], description: "Fixture data", mimeType: "application/json" } }, facilitator));
  app.get("/data", (_req, res) => { res.json({ resource: "paid-content" }); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/data`;
  try {
    const unpaid = await fetch(url);
    assert.equal(unpaid.status, 402);
    assert.equal(verifies, 0);
    const challenge = parseCanonical402(unpaid);
    const accepted = challenge.accepts[0]!;
    assert.equal(accepted.amount, "10000000");
    assert.equal(accepted.extra?.areFeesSponsored, true);
    const header = encodePaymentSignatureHeader({ x402Version: 2, resource: challenge.resource, accepted, payload: { transaction: "fixture-xdr-not-submitted" } });
    const paidFetch = () => fetch(url, { headers: { "PAYMENT-SIGNATURE": header } });
    const paid = await paidFetch();
    assert.equal(paid.status, 200);
    assert.deepEqual(await paid.json(), { resource: "paid-content" });
    assert.equal(parseStellarPaymentResponse(paid, network).success, true);
    assert.equal(settles, 1);
    valid = false;
    const rejected = await paidFetch();
    assert.equal(rejected.status, 402);
    assert.equal(settles, 1);
    assert.doesNotMatch(await rejected.text(), /paid-content/);
    valid = true;
    settled = false;
    const failed = await paidFetch();
    assert.notEqual(failed.status, 200);
    assert.doesNotMatch(await failed.text(), /paid-content/);
    assert.equal(settles, 2);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
