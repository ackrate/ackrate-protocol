# Ackrate npm packages

Ackrate publishes typed ESM packages with packed API documentation and examples.
The SDK is untrusted infrastructure: it never receives the user allowance and
cannot replace the contract's `execute_payment` checks.

## Release matrix

All five coordinated Mainnet-default versions are **published and verified**.
Registry checks on **2026-09-07 at 04:25:38–04:25:45 Bangkok (UTC+7)** matched
their `latest` tags and downloaded archive SHA-512 integrity values. A fresh
combined public install passed strict TypeScript, ESM imports, default-contract,
full V2 interface, packed README, and CLI confirmation-guard checks at **04:25:11**,
with zero dependency findings. See the [dated Step 1 release evidence](t3-step-1-gate-2026-09-07.md).

The earlier **03:33 Bangkok** registry checkpoint is retained below as history;
older packages do not acquire the new defaults or APIs automatically.

| Package | Current public version | Earlier 03:33 checkpoint | Purpose |
|---|---:|---:|---|
| `@ackrate/core` | 0.4.0 | 0.3.4 | Mainnet-default mandates, returned V2 storage IDs, bound-v2 `agent.fetch`, receipts, recovery. |
| `@ackrate/stellar` | 0.3.0 | 0.2.5 | Built-in official `MAINNET` and deployment manifest, signing and token helpers. |
| `@ackrate/ap2` | 0.4.0 | 0.3.2 | Signed AP2 profile validation and replay admission into the Mainnet Core flow. |
| `@ackrate/express-middleware` | 0.3.0 | 0.2.4 | Mainnet USDC bound-v2 Express payment boundary and chain verifier. |
| `@ackrate/cli` | 0.2.0 | 0.1.9 | Mainnet-default commands with bundled official manifest, crash-safe recovery, governed operations, and reference-agent HTTP demo. |

Release source is [`d0aee2127cc08e43f0c70868de46db75bda71ed7`](https://github.com/ackrate/ackrate-protocol/commit/d0aee2127cc08e43f0c70868de46db75bda71ed7).
[CI run 34060795268](https://github.com/ackrate/ackrate-protocol/actions/runs/34060795268)
was confirmed successful at **04:27 Bangkok**. These technical release results do
not claim completion of all T3 deliverables or grant acceptance. Step 1 remains
under user review; Steps 2–4 are paused.

The coordinated set requires **Node.js 22+** and pins **`@stellar/stellar-sdk@16.3.0`**.
Core requires Stellar binding `^0.3.0`; AP2 requires core `^0.4.0`; middleware
requires core `^0.4.0` and Stellar binding `^0.3.0`. These dependency floors
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
npm install -g @ackrate/cli@0.2.0
ackrate --help
```

Follow the [Mainnet signer and payment prerequisites](cli.md) before running
the paid demo. Authorized contract upgrades replace the implementation at the
same address; compatibility and deployment-evidence checks still apply.

## Install commands and availability

Use Node.js 22 or newer. Install the published application client:

```bash
npm install --save-exact @ackrate/core@0.4.0 @stellar/stellar-sdk@16.3.0
```

Add the other published libraries for the full pinned SDK set:

```bash
npm install --save-exact @ackrate/stellar@0.3.0 @ackrate/ap2@0.4.0 @ackrate/express-middleware@0.3.0 @stellar/stellar-sdk@16.3.0
```

## Bound-v2 client API

```ts
const agent = ackrate.agent({
  mandate,
  signer: agentKey,
  proofPolicy: "bound-v2-only",
  receiptStore,
});

const response = await agent.fetch(url);
const receipt = getSettlementReceipt(response);
const result = await response.json();
await persistAcceptedResult(result, receipt);
if (receipt) await agent.acknowledgeDelivery(receipt);
```

Important exports:

| Export | Purpose |
|---|---|
| `MAINNET` / `ackrate.mainnet` | Official default registry, network, and canonical USDC configuration. |
| `MAINNET_DEPLOYMENT_MANIFEST` | Bundled complete public deployment evidence. |
| `ackrate.createIntentMandate` | Canonical local mandate construction. |
| `registerMandate` / `approveBudget` | User-authorized on-chain setup. |
| `Agent.pay` | Agent-authorized `execute_payment`. |
| `Agent.fetch` | Bound-v2 capability, challenge validation, payment, signed proof, and delivery. |
| `SettlementReceiptStore` | Durable pre-broadcast save, restart enumeration, and explicit clear interface. |
| `getSettlementReceipt` | Exact receipt from a successful paid response. |
| `DeliveryPendingError` | Typed post-submission settlement/delivery uncertainty. |
| `SettlementUncertainError` | Direct-pay hash was prepared and broadcast was attempted, but final state is unknown. |
| `PendingSettlement` / `SettlementReconciliation` | Exact hash, validity window, and reconciliation result. |
| `Agent.getPendingSettlement` / `reconcilePendingSettlement` | Restore/query one hash without submitting another transaction. |
| `Agent.retryDelivery` | Exact-proof delivery retry with no payment or signature. |
| `Agent.acknowledgeDelivery` | Clears the durable receipt only after application commit. |

`proofPolicy: "bound-v2-only"` is required for new paid endpoints. The
`"legacy-compatible"` default exists only for migration. Paid fetch requires a
receipt store with `savePending`, `listPending`, and `clearPending`; the signed
hash is durable before broadcast, and restart blocks every new payment until the
same receipt is reconciled/recovered and explicitly acknowledged.

Direct `Agent.pay` also fails before network unless its required `onPrepared`
hook durably journals the signed hash and validity window. The CLI demonstrates
that contract with `ackrate settlement reconcile` plus explicit exact-hash
`ackrate settlement acknowledge <TX_HASH>` for a successful result.

## Express API

Use `createBoundAckratePaidJsonRoute`, a stable private challenge secret, an exact
configured public HTTP(S) origin, and a required `BoundRedemptionStore`. GET is
the only paid method. The route verifies the exact challenge, chain-derived
agent signature, MandateRegistry event, current identities, and matching SEP-41
transfer; then it atomically claims fulfillment once and commits bounded JSON
bytes before sending them.

The exact completed proof replays those stored bytes without verifier or
callback execution. The same transaction with another proof returns `409`; an
executing claim or infrastructure outage returns `503`. In-memory state is
demo-only; multi-worker production requires a shared durable linearizable
claim/result store and a transactional outbox for external side effects. Only a
trusted operator/outbox, after proving the execution owner is dead, may call
`resolveBoundAckrateInterruptedDelivery` to commit one terminal result.

## AP2 API

`createAp2ComplianceValidator` checks strict schema and versions, Stellar
Ed25519 signature, separately trusted user, merchant scope, amount, expiry,
binding hash, and atomic replay admission. Its 59-test suite covers valid and
adversarial cases. Cumulative spending and payment replay remain contract checks.

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
checks for the published release with:

```bash
npm view @ackrate/core@0.4.0 version dist.integrity
npm view @ackrate/stellar@0.3.0 version dist.integrity
npm view @ackrate/ap2@0.4.0 version dist.integrity
npm view @ackrate/express-middleware@0.3.0 version dist.integrity
npm view @ackrate/cli@0.2.0 version dist.integrity
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
