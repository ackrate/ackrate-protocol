# Ackrate npm packages

September 27 candidate: [contract-independent x402 changes](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/x402-sdk-compatibility-2026-09-27.md). Package publication status is recorded separately from test results.

Ackrate publishes typed ESM packages with packed API documentation and examples.
The SDK is untrusted infrastructure: it never receives the user allowance and
cannot replace the contract's `execute_payment` checks.

## Release matrix

### September 27 candidate — not yet published

| Package | Published latest checked September 27 | Candidate |
|---|---:|---:|
| `@ackrate/core` | 0.4.1 | 0.4.2 |
| `@ackrate/ap2` | 0.4.0 | 0.4.1 |
| `@ackrate/express-middleware` | 0.3.0 | 0.3.1 |
| `@ackrate/cli` | 0.2.1 | 0.2.2 |
| `@ackrate/stellar` | 0.3.0 | Unchanged; do not republish |

The candidate requires Node.js 22+ and Stellar SDK 16.3.0. Core requires
Stellar `^0.3.0`, AP2 accepts core `^0.4.0`, and middleware requires core
`^0.4.2` plus Stellar `^0.3.0`. The CLI bundles the candidate core implementation.
The [compatibility notes](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/x402-sdk-compatibility-2026-09-27.md) describe the
stricter legacy challenge selection and the separate canonical adapters.
Local verification does not establish npm availability or live settlement.

After publication and registry integrity verification, install the candidate set:

```bash
npm install --save-exact @ackrate/core@0.4.2 @ackrate/stellar@0.3.0 @ackrate/ap2@0.4.1 @ackrate/express-middleware@0.3.1 @stellar/stellar-sdk@16.3.0
npm install -g @ackrate/cli@0.2.2
```

Until those versions are published, the published installation commands below
continue to refer to the September 7 release. Historical evidence is retained.

### September 7 setup-recovery release

**Core 0.4.1 and CLI 0.2.1 are published and verified.** A fresh public-registry
install on Node.js 22.23.2 passed strict TypeScript with `skipLibCheck: false`,
runtime ESM imports, the official Mainnet contract and full 18-function V2
interface checks, CLI version/help, and confirmation/recovery-flag rejection
checks. The complete dependency tree reported no dependency problems. Runtime
probes blocked networking and child processes and recorded zero signer calls.
The public verification record completed at **18:05:19 Bangkok on September 7,
2026 (11:05:19 UTC)**. See the
[public package verification](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/public-npm-release-verification-20260907T110304Z.json).

The published CLI archive matches the verified archive, and its executable is
byte-identical to the bundle exercised by the live run:
`c2e6c113a6fdcad618927c59a304da525628041c7d10626d430712c2f7e2ce69`
(SHA-256), built from
[`8c74bef`](https://github.com/ackrate/ackrate-protocol/commit/8c74bef3af3ce7aee0ab2c8da6f126706a8a4e18).
Stellar 0.3.0, AP2 0.4.0, and Express middleware 0.3.0 remain unchanged; their
compatible dependency ranges resolve Core 0.4.1 in the verified fresh install.

Core 0.4.1 adds shared payment-receipt ownership and fail-closed reconciliation
fixes. CLI 0.2.1 adds explicit Mainnet registration-only setup recovery. It
verifies the exact confirmed transaction and untouched on-chain mandate before
reusing it; no registration, funding, expiry extension, or previous purchase is
repeated. See the
[CLI recovery requirements](../packages/cli/README.md#run-the-reference-research-agent).

The bounded Mainnet run completed at **17:59:29 Bangkok**. Independent public
RPC and Horizon checks verified three distinct **0.01 USDC** payments and their
matching Circle USDC transfers, mandate sequence **3**, spent amount **0.03
USDC**, payer USDC balance **0**, and merchant USDC balance **0.03**. Public agent
history contained exactly those three successful agent transactions and no
fourth applied transaction. A separate read-only `validate_mandate` simulation
for another 0.01 USDC returned contract error **6 (BudgetExceeded)**. The
[independent receipt record](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/cli-mainnet-independent-receipts-2026-09-07.json)
contains all hashes, identities, amounts, ledgers, and verification qualifications.

These are bounded verification results, not a guarantee against every failure.
Generic SDK/CLI expiry reconciliation retains its lock when RPC supplies
decimal-string history timestamps. The hosted runner's periodic receipt copies
can miss the last local write on an abrupt host failure; the run stays locked
for manual reconciliation. Public-chain receipts corroborate transfers and
budget enforcement; HTTP delivery also relies on retained consumer/fulfillment
output. The earlier release records below remain historical evidence.

### Coordinated Mainnet baseline

All five coordinated Mainnet-default versions are **published and verified**.
Registry checks on **2026-09-07 at 04:25:38–04:25:45 Bangkok (UTC+7)** matched
their `latest` tags and downloaded archive SHA-512 integrity values. A fresh
combined public install passed strict TypeScript, ESM imports, default-contract,
full V2 interface, packed README, and CLI confirmation-guard checks at **04:25:11**,
with zero dependency findings. See the [dated baseline release evidence](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/t3-step-1-gate-2026-09-07.md).

The earlier **03:33 Bangkok** registry checkpoint is retained below as history;
older packages do not acquire the new defaults or APIs automatically.

| Package | Public version at 04:25 baseline | Earlier 03:33 checkpoint | Purpose |
|---|---:|---:|---|
| `@ackrate/core` | 0.4.0 | 0.3.4 | Mainnet-default mandates, returned V2 storage IDs, bound-v2 `agent.fetch`, receipts, recovery. |
| `@ackrate/stellar` | 0.3.0 | 0.2.5 | Built-in official `MAINNET` and deployment manifest, signing and token helpers. |
| `@ackrate/ap2` | 0.4.0 | 0.3.2 | Signed AP2 profile validation and replay admission into the Mainnet Core flow. |
| `@ackrate/express-middleware` | 0.3.0 | 0.2.4 | Mainnet USDC bound-v2 Express payment boundary and chain verifier. |
| `@ackrate/cli` | 0.2.0 | 0.1.9 | Mainnet-default commands with bundled official manifest, crash-safe recovery, governed operations, and reference-agent HTTP demo. |

Release source is [`d0aee2127cc08e43f0c70868de46db75bda71ed7`](https://github.com/ackrate/ackrate-protocol/commit/d0aee2127cc08e43f0c70868de46db75bda71ed7).
[CI run 34060795268](https://github.com/ackrate/ackrate-protocol/actions/runs/34060795268)
was confirmed successful at **04:27 Bangkok**. This records the earlier coordinated
release; the later Core and CLI patch verification is documented above.

The September 7 coordinated set requires **Node.js 22+** and pins **`@stellar/stellar-sdk@16.3.0`**.
Core requires Stellar binding `^0.3.0`; AP2 requires core `^0.4.0`; middleware
0.3.0 requires core `^0.4.0` and Stellar binding `^0.3.0`. Candidate middleware
0.3.1 raises its core floor to `^0.4.2`. These dependency floors
prevent a new install from silently retaining older Mainnet-default-incompatible
packages. Historical package versions and receipts are unchanged.

## Mainnet contract mapping

The five coordinated versions above target
[Mainnet V2 MandateRegistry CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR)
as the official Mainnet default. The canonical identity is
`DEPLOYMENTS.mainnet.mandateRegistryId` in
[`packages/stellar/src/deployments.ts`](../packages/stellar/src/deployments.ts).
The [package-by-package configuration guide](mainnet-configuration.md) explains
how Core, AP2, middleware, and the rebuilt CLI use that identity, and links the
contract deployment README. `MAINNET` and `ackrate.mainnet` expose the ready
configuration, and the CLI bundles the complete official manifest. A manual
manifest is not needed for the official deployment. Configuration alone never
authorizes a payment: signatures, user-approved limits, and real-USDC CLI
confirmation remain required.

The unrelated npm package `ackrate-cli` is owned by another publisher. Install
the project's published CLI using its unambiguous package name:

```bash
npm install -g @ackrate/cli@0.2.1
ackrate --help
```

Follow the [Mainnet signer and payment prerequisites](cli.md) before running
the paid demo. Authorized contract upgrades replace the implementation at the
same address; compatibility and deployment-evidence checks still apply.

## Install commands and availability

Use Node.js 22 or newer. Install the published application client:

```bash
npm install --save-exact @ackrate/core@0.4.1 @stellar/stellar-sdk@16.3.0
```

Add the other published libraries for the full pinned SDK set:

```bash
npm install --save-exact @ackrate/stellar@0.3.0 @ackrate/ap2@0.4.0 @ackrate/express-middleware@0.3.0 @stellar/stellar-sdk@16.3.0
```

## API guides

Runnable examples and recovery requirements live in the package READMEs:
[Core](../packages/sdk/README.md), [Stellar](../packages/stellar/README.md),
[AP2](../packages/ap2/README.md), [Express](../packages/express-middleware/README.md)
and [CLI](../packages/cli/README.md). Use [Testnet workflows](testnet-workflows.md)
for explicit network adaptations and [dated workflow evidence](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/npm-workflow-evidence-2026-09-27.md)
for live validation results. Historical release receipts above do not certify
unpublished candidate tarballs.

## Clean-package gate check

```bash
npm ci
npm run gatecheck:release
```

The gate check:

- cleans generated output;
- builds and typechecks the workspace;
- runs all package and app tests;
- dry-inspects and builds real tarballs for every public package;
- checks exact name/version, README, JavaScript, and declaration files;
- rejects install lifecycle scripts, source/test leakage, env files, and secret-like paths;
- installs all five tarballs into an empty project, strict-typechecks public
  imports, executes ESM imports and the CLI binary;
- verifies private internal documents are not tracked; and
- checks public terminology.

Registry proof is a separate external check. Reproduce the version and integrity
checks for the September 7 published release with:

```bash
npm view @ackrate/core@0.4.1 version dist.integrity
npm view @ackrate/stellar@0.3.0 version dist.integrity
npm view @ackrate/ap2@0.4.0 version dist.integrity
npm view @ackrate/express-middleware@0.3.0 version dist.integrity
npm view @ackrate/cli@0.2.1 version dist.integrity
```

After candidate publication, verify each new version separately before changing
its status to published:

```bash
npm view @ackrate/core@0.4.2 version dist.integrity
npm view @ackrate/ap2@0.4.1 version dist.integrity
npm view @ackrate/express-middleware@0.3.1 version dist.integrity
npm view @ackrate/cli@0.2.2 version dist.integrity
```

Then install into an empty temporary project, compile strict TypeScript imports,
and run a runtime ESM import. Local workspace success is not substituted for
public registry evidence. Also check minimal consumer installs and their actual
dependency trees: root application overrides do not propagate into npm library
consumers. The CLI embeds the workspace implementation at bundle time, so it
must be rebuilt after the libraries; installing a newer core package does not
repair an older CLI bundle.

## Historical profiles

Previous package releases and their separate development-network or canary
deployments remain historical evidence. They do not describe the new official
Mainnet default. Use the [current contract configuration map](mainnet-configuration.md)
and the versioned release matrix above to identify which behavior is available.
