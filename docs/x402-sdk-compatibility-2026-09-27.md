# Contract-independent x402 release

Candidate versions: core 0.4.2, CLI 0.2.2, Express middleware 0.3.1, AP2 0.4.1.
Stellar bindings stay at 0.3.0. No contract, deployment manifest, DApp source or
wallet/device workflow changes. Implementation lives on `v2-dev`.

## Changes

- `Agent.fetch` requires the version-1 Ackrate envelope and explicit supported
  scheme, legacy network, asset and merchant. Canonical v2 headers/bodies fail
  before spending. Selection skips unsupported/mismatched offers; missing or
  malformed identities never acquire defaults. Bound-only policy is preserved.
- Legacy amounts remain positive display-unit decimal strings. Numeric values,
  exponent notation and conflicting aliases are rejected. Canonical atomic i128
  amounts live in `@ackrate/core/x402`, which has no signing or spending path.
- The canonical subpath uses upstream v2 challenge schemas, validates Stellar
  exact selection, and decodes success/failure settlement headers. Decoding is
  not independent on-chain verification.
- `@ackrate/express-middleware/canonical` registers upstream Stellar exact server
  schemes with upstream Express middleware and an explicit facilitator. Its
  HTTP round-trip fixtures cover missing payment, valid verification/settlement,
  failed verification, and failed settlement. No live value moves in these tests.
- `@ackrate/ap2/sd-jwt` selectively ports the standalone cryptographic module from
  `ap2v0.2` at b32ef46. Supported JWS algorithms are bound to exact key curves;
  unsupported `crit`/`b64` profiles and inconsistent JWK metadata fail closed.
  This is not full AP2 v0.2 validation or a contract-level authorization path.

## Compatibility and limits

Core 0.4.2 deliberately tightens challenge acceptance in a patch release.
Custom scheme/network labels, non-public/non-testnet network passphrases,
missing version-1 identity fields, and dual-stack responses carrying a canonical
`payment-required` header alongside a legacy body are refused before spending.
Merchants using middleware custom scheme/network options must switch to the
supported Ackrate labels. Standard Ackrate middleware already emits the complete
version-1 envelope. Existing integrations relying on implicit defaults must be
updated before adopting this candidate.

The legacy Ackrate proof and canonical exact scheme remain distinct. The existing
registry spends through `execute_payment` and SEP-41 `transfer_from`; the
[canonical Stellar spec](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md)
requires a token `transfer` with signed authorization entries. No direct-wallet
signing bypass was introduced. Canonical bounded payer support remains outside
this release. Canonical packages are pinned to x402 Foundation 2.27.0, checked
September 27, 2026; later upstream changes require review.

The canonical server delegates transaction validation and settlement to its
configured facilitator. Local fake-facilitator tests establish wire compatibility,
not provider correctness, live settlement, replay durability or production
readiness. Read-only/idempotent handlers are required because upstream executes
the handler before settlement while withholding its response until success.

SD-JWT chain cryptographic verification does not validate business constraints,
root issuer trust, full AP2 semantics or replay policy. Existing AP2 admission
continues to use its current validator; callers of the new subpath must supply
those independent policy checks. Hosted gateway integration belongs to ACK-009;
DApp staging V2 and cross-device work remains owned by the other thread.
