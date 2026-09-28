# Repository inventory — 2026-07-12

## Packages

| Path | Public surface | Ownership |
|---|---|---|
| `packages/sdk` | `@ackrate/core@0.3.3` | High-level mandates, contract payments, bound-v2 client, receipts and recovery. |
| `packages/stellar` | `@ackrate/stellar@0.2.5` | Generated typed bindings, verified Mainnet manifest gate, signer and SEP-41 helpers. |
| `packages/ap2` | `@ackrate/ap2@0.3.2` | Signed AP2 v0.1 profile validator and replay admission. |
| `packages/express-middleware` | `@ackrate/express-middleware@0.2.4` | Exact-origin GET proof, Stellar verifier, and atomic claim/immutable-result route. |
| `packages/cli` | `@ackrate/cli@0.1.10` | `init`, `setup`, mandate, crash-safe pay/reconcile/acknowledge, and Mainnet demo flow. |

## Reference applications

| Path | Role |
|---|---|
| `apps/consumer-agent` | Bound-only ResearchAgent, pre-broadcast `FileSettlementReceiptStore`, immutable `FilePurchaseOutcomeStore`, restart recovery, explicit app acknowledgment. |
| `apps/fulfillment-agent` | Safe paid JSON API, `FileBoundRedemptionStore`, independent chain verification, immutable replay. |

The file stores are durable single-process references. Multi-worker production
requires shared linearizable storage.

## Contracts

All Rust contract source, tests, builds, and releases live in
[`ackrate-protocol-contracts`](https://github.com/ackrate/ackrate-protocol-contracts).
The Mainnet V2 source is `contracts/mainnet-v2/mandate-registry`. The former local
contract is preserved there as `contracts/legacy-protocol/mandate-registry` for
historical Testnet reproduction. See [Mainnet V2 deployment record](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
for exact deployment and artifact evidence.

## Release and evidence scripts

| Script | Purpose |
|---|---|
| `scripts/verify.mjs` | Clean workspace build, strict types, tests, branding and dependency checks. |
| `scripts/gatecheck-release.mjs` | Full release gate, real tarballs, empty-project strict types/imports/CLI, and public/private boundaries. |
| `scripts/e2e-x402.ts` | Three bound-v2 testnet purchases, fourth budget rejection, replay conflict. |
| `scripts/failure-drills-testnet.ts` | Revocation, merchant downtime recovery, and expiry drills. |
| `scripts/e2e-sdk.mjs` | Direct SDK testnet contract flow. |
| `scripts/gatecheck-mandate.mjs` | Read-only inspection of a live testnet mandate. |

## Documentation

- Deliverable evidence: `docs/cli.md`, `docs/sdk-packages.md`, `docs/reference-agents.md`, `docs/ap2-validator.md`, `docs/enforcement-evidence.md`.
- `docs/hackathon-quickstart.md`: external developer path.
- `docs/express-vscode-quickstart.md`: hosted Express companion path.
- `docs/playbook-testnet.md`: contract-to-SDK release procedure.
- `docs/security/threat-model.md` and `docs/security/data-flow.md`: current security model.

Dated June security reports and composite work logs are historical snapshots.
They are not current version or deployment sources.

## Private-file boundary

`ACKRATE_PROGRESS_LOG.md` and `CONTRACT_UPGRADE_PLAYBOOK.md` are private operator
documents outside this repository. The release gate fails if either filename becomes
tracked. Credentials, testnet secrets, receipt files, and redemption files also
remain untracked.
