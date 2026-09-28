# AGENTS.md

This file guides coding agents (Claude Code and compatible tools) working in this
repository. It is also surfaced as `CLAUDE.md` via a symlink, so both names resolve
to this single source.

## What this is

Agent-driven payments on Stellar. A user signs an AP2 **IntentMandate**; an AI
agent pays for a 402-gated resource via **x402**; the Soroban **MandateRegistry**
contract enforces scope, budget, expiry, and replay at consume time. A compromised
agent or SDK cannot exceed the mandate.

**The core invariant:** Mainnet money moves only through
`MandateRegistry.execute_payment`, which validates and consumes the mandate
atomically before transfer. The user approves the SEP-41 allowance for the
contract, never the agent or SDK. Historical composite variants have a separate
`clear_pool` interface; they are not the Mainnet V2 implementation.

## Commands

This is an npm workspaces monorepo (`packages/*`, `apps/*`). Rust contracts,
contract tests, builds, and releases belong to `ackrate-protocol-contracts`.

- `npm run verify` — the local CI-equivalent gate; **run this before every push.**
  Runs a clean workspace build, strict typecheck, branding checks, tests, and dependency checks. Mirrors the TypeScript job in `.github/workflows/ci.yml`; the separate Rust
  job checks a pinned contracts-repo revision. Wired as a git pre-push
  hook via `git config core.hooksPath .githooks` (one-time, per clone).
- `npm run build` — builds `@ackrate/stellar` first (the others depend on it),
  then all workspaces.
- `npm test` — runs every workspace's tests.
- `npm run typecheck` — root `tsc` (project references).

Contract source and commands: see [source of truth](docs/contract-source-of-truth.md).
The contract repository owns Rust formatting, linting, tests and release gates.

SDK / app tests use the Node test runner via tsx, e.g.
`node --import tsx --test packages/sdk/src/x402.test.ts`.

On-chain scripts (need a funded testnet burner in `.env` — copy `.env.example`):
- `npm run demo` — the "aha": happy path + rogue rejections (overspend, replay,
  pay-after-revoke) on testnet.
- `npm run e2e:x402` — full x402 round-trip: ResearchAgent buys from the 402-gated
  merchant via `agent.fetch`; three settle on-chain, the fourth is budget-rejected.
- `npm run e2e:testnet`, `npm run e2e:sdk` — lower-level on-chain e2e.
- `npm run gatecheck` — independent on-chain mandate gatecheck tool.
- `npm run deploy:testnet` — deploy the historical Testnet variant from an external contracts checkout;
  set `ACKRATE_CONTRACTS_ROOT` and fill the resulting ids into `.env`.
- `npm run keys:derive-freighter` — scan BIP39 indexes to match a Freighter pubkey
  (seed typed at runtime, never stored).

## Architecture

Data/trust flow: **user** signs a mandate → SDK registers it + approves the
allowance *for the contract* → **agent** calls `execute_payment` → contract
validates+consumes, then does the SEP-41 `transfer_from(user → merchant)`.

### Contract ownership

Mainnet V2 source is `ackrate-protocol-contracts/contracts/mainnet-v2/mandate-registry`.
The former local development contract is preserved in that repository under
`contracts/legacy-protocol/mandate-registry`; it is not the Mainnet source.
See [deployment provenance and migration](docs/contract-source-of-truth.md).

### `packages/stellar/` — `@ackrate/stellar` (typed Soroban layer)
Network config (`TESTNET`), the generated/typed `registryClient` contract bindings,
SEP-41 `token` helpers, and `keypairSigner`. Built first; everything else depends on it.

### `packages/sdk/` — `@ackrate/core` (thin, untrusted client)
The under-10-line flow (`ackrate.createIntentMandate` → `registerMandate` →
`approveBudget` → `agent()` → `agent.pay`/`agent.fetch`). Key files:
- `index.ts` — `ackrate` facade + the `Agent` class. `createIntentMandate` defines the
  **canonical hash** (mandate id) by a fixed JSON field order — *changing that order
  changes every id*; keep it stable. `toStroops` is strict-by-design money parsing
  (rejects anything that could wrap to a wrong on-chain i128).
- `x402.ts` — the **only** place that knows the HTTP shape of the 402 challenge and
  the `X-PAYMENT` settlement-proof header. Isolated so the moving x402 v0.2/v0.3 wire
  format can change without touching the contract or `Agent.pay`. The proof is a
  *settlement* proof (payment already happened on-chain); the merchant re-verifies
  the txHash on-chain — the header is never trusted on its own.

### `packages/ap2/` — `@ackrate/ap2` (version-pinned bridge)
Maps the supported AP2 v0.1.0 human-not-present IntentMandate subset into the
existing core mandate without changing core's canonical hash. Unsupported SKU,
refundability, multi-merchant, and cart-confirmation semantics fail closed. AP2
normalization and evidence stay separate from x402, and the contract remains the
only enforcement boundary.

### `apps/`
- `fulfillment-agent/` — reference 402-gated merchant; verifies payment on-chain
  before serving.
- `consumer-agent/` — reference ResearchAgent; buys sources via `agent.fetch`, budget
  enforced on-chain.

## Conventions

- **Security boundary discipline:** SDK-side checks (e.g. `Agent.fetch` comparing the
  402's `payTo` to the mandate merchant) are fail-fast convenience only. The real
  boundary is always the contract + the merchant's on-chain verification. Don't
  present an SDK check as the enforcement.
- **Terminology:** use “gate check” in reports, documentation, and commit messages;
  never reintroduce the prohibited T1 review term.
- The contract is gatechecked and live on testnet; treat its interface as a published
  contract. The negative/§10 suite is not optional and must stay green from commit one.
- `docs/security/` holds the contract, SDK, and x402 gatecheck records; the release docs
  `docs/mandate-registry-contract.md`, `docs/ackrate-sdk-npm.md`, and `docs/x402-roundtrip.md`
  document each shipped step. Update them when the matching surface changes.
- The published SDK and CLI default to the verified Mainnet registry. Select Testnet explicitly for development scripts. Hot burner keys are testnet-only, never reused on
  mainnet, and never committed. Mainnet paths require the complete verified
  deployment manifest, canonical USDC, explicit real-value confirmation, and
  external or secret-manager-backed signing; they must never fall back to testnet.
