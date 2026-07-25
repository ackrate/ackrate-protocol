# AP2 v0.2 bridge validator

`@reapp-sdk/ap2` provides both REAPP's signed AP2 v0.2 Open Payment admission
profile and merchant-facing open/closed Delegate SD-JWT verification.

The admission profile is intentionally narrow: strict schema/version
boundaries, Stellar Ed25519 user and agent binding, one payee, matching amount
and cumulative budget, expiry, checkout reference, binding hash, and atomic
admission replay. The merchant APIs separately verify open/closed Checkout and
Payment chains, selective disclosures, linkage, supported constraints, and
receipts. Unsupported constraints fail closed. AP2 and x402 remain separate
from `MandateRegistry`.

## Local validation

```bash
npm install @reapp-sdk/ap2@0.4.0 @reapp-sdk/core@0.3.1 @stellar/stellar-sdk
```

See the package [quick start](../packages/ap2/README.md#quick-start) for the full
construction and validation example.

`validateAndConsume` requires trusted `expectedUser`, `merchant`, and `amount`
inputs, plus `checkoutReference` for v0.2 — a v0.1 IntentMandate carries no
checkout binding, so the field is ignored on that path. On success it returns
the exact core mandate to register. Its replay check is admission-only; cumulative spending
and payment replay remain atomically enforced on-chain.

## Running AP2 v0.1 alongside v0.2

Both versions are fully supported. `signAp2V01Mandate` signs the v0.1
IntentMandate profile and `signAp2Mandate` signs the v0.2 Open Payment profile;
one validator admits either. Nothing is inferred — the version is a property of
the function you call, so a caller can never be handed a different protocol
version than it asked for.

The v0.1 output is byte-identical to `@reapp-sdk/ap2@0.3.0` for the same inputs,
including the same `stellar.nonce` — omit the nonce and both versions draw a
fresh random one, as they always have. That equivalence is pinned by a vector in
`packages/ap2/src/legacy-v01.test.ts` generated from the published 0.3.0
package. A merchant still running a 0.3.x
validator therefore accepts credentials this package signs today.

Mandates already registered through the v0.1 bridge remain executable because
the contract interface and stored `Mandate` shape are unchanged. The v0.2
admission bridge supplies the same contract-facing fields, so no Simple
registry change is needed.

Credential admission recognizes both versioned envelopes. A
`reapp-ap2-credential/1` value follows the exact legacy v0.1 IntentMandate
schema and validation rules; `reapp-ap2-credential/2` follows the v0.2 Open
Payment profile and additionally requires trusted checkout-reference context.
Cross-version hybrids and unknown versions fail closed.

Prefer v0.2 for new integrations: it binds the payment to a specific checkout,
which v0.1 has no way to express.

The source implementation also supports a separate AP2 authorization contract
and an AP2-aware Composite pool mode. Simple and released Composite children
use distinct typed capture kinds. Pooled children use the REAPP
pool-participation VCT, exact schedule hash, commit-time authorization, and
capture-time Composite hook. Legacy and AP2 pools coexist but do not mix
member modes inside one pool.

The [merchant interoperability document](ap2-merchant-extension.md) explains
the flows and current release boundary. The extension and updated Composite
source are locally tested but not deployed, so the published testnet contracts
do not yet expose those new routes.

## Test suite

```bash
npm test -w @reapp-sdk/ap2
```

The package suite contains 77 named cases, including 32 individually reported
validator cases and 8 v0.1 compatibility cases. It covers canonical admission binding, open/closed SD-JWT chains,
disclosures, Checkout/Payment linkage, known and unknown constraints,
merchant/amount context, receipts, REAPP pool participation, byte-exact
Soroban authorization vectors, expiry, replay concurrency, store outages, and
replay poisoning.
