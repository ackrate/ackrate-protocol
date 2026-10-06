# Testnet package workflows

Use Node.js 22 or newer. Mainnet is the SDK and CLI default, so select Testnet
explicitly for every step below. Testnet actors are disposable; never reuse
their keys on Mainnet. These workflows need no wallet extension or LLM key.

[Release status](ackrate-sdk-npm.md#release-matrix) identifies published versions
and unpublished candidates. Install candidate tarballs from a completed
`npm run gatecheck:release -- --keep-artifacts` run when validating a release;
do not silently substitute npm's older `latest` versions. The gate prints the
artifact directory. In a separate empty consumer directory, install the four
candidate tarballs plus published `@ackrate/stellar@0.3.0` and the exact Stellar
SDK version from the release matrix. Include Express for merchant examples.
Use that consumer's `node_modules/.bin/ackrate` for the installed CLI checks.

## Installed CLI research agent

```bash
ackrate demo research-agent --network testnet
```

The command creates three Friendbot-funded actors, registers a 3 XLM mandate,
approves the contract allowance and serves three paid resources. Success requires
three verified deliveries, exactly 3 XLM received, no pending receipts and a
fourth purchase rejected by the contract. A bare `ackrate demo` only lists usage.

## Persistent CLI project and recovery

From an empty working directory with `ackrate` on PATH:

```bash
ackrate init --network testnet
ackrate setup
ackrate mandate create
ackrate pay
ackrate settlement reconcile
ackrate settlement acknowledge <EXACT_CONFIRMED_TX_HASH>
ackrate settlement reconcile
```

The first reconciliation must refer to the same payment hash; acknowledgment
clears its durable lock, and the final reconciliation reports no pending payment.
Preserve private CLI state. `ACKRATE_HOME` can select a private directory before
starting a new independent workflow; do not move an unresolved workflow to a
new directory to bypass its lock. Mainnet-only registration recovery is described
once in the [CLI README](../packages/cli/README.md#run-the-reference-research-agent).

## SDK and AP2 examples

Use the canonical [Core](../packages/sdk/README.md#authorize-a-budget-and-pay),
[AP2](../packages/ap2/README.md#signed-validator-quick-start) and
[Stellar](../packages/stellar/README.md#read-a-balance) examples with these explicit
substitutions:

- Fund fresh actors through Friendbot and use `TESTNET` from `@ackrate/stellar`.
- Replace the Mainnet USDC asset with `TESTNET.nativeSac` (Testnet XLM).
- Pass `TESTNET` to `createIntentMandate`, `registerMandate`, `approveBudget`,
  `agent` and `revokeMandate`; supply Testnet to every `token` helper.
- Use Testnet signers, a `stellar-testnet:<registry>` AP2 replay namespace and
  `stellar-testnet` in legacy merchant challenges.
- Provide durable `saveMandate`, payment-journal, receipt and result-store
  integrations where the snippets name them; they are not implicit SDK globals.
- Retain the registered on-chain mandate ID. Verify the exact merchant balance
  delta, state sequence and transaction result, then revoke the test mandate.

For the standalone repository SDK lifecycle, configure a Friendbot-funded
burner through the ignored `.env` template and run `npm run e2e:sdk`. It proves
registration, allowance, payment, over-budget rejection, revocation and rejection
after revocation. Keep its signer material out of terminal output.

## Local Express and reference agents

From a source checkout:

```bash
npm ci
npm run agents:testnet
npm run drills:testnet
npm run adversarial:testnet
```

The reference run supplies a local merchant and consumer. The drills exercise
revocation, merchant outage after payment with exact-receipt recovery, and expiry
between quote and settlement. The six adversarial scripts additionally cover
AP2 forgery, replay, allowance custody and a stale-sequence transaction that is
included in a ledger and reverted. See the [test descriptions](../scripts/adversarial/README.md).
A hosted workbench is not required.

For your own merchant, follow the [Express example](../packages/express-middleware/README.md#safe-paid-route)
with Testnet network, asset, funded read source and an exact local origin. Keep
the challenge key stable and use durable stores. Recovery must not repay or rerun
fulfillment; see the [Core recovery API](../packages/sdk/README.md#recover-the-original-purchase).

## Canonical Stellar x402

Follow the separate [canonical middleware example](../packages/express-middleware/README.md#canonical-stellar-x402-resource-server)
with `stellar:testnet`, `TESTNET.nativeSac`, and an explicitly configured
facilitator that supports that network. Prices are atomic strings, not display
amounts. Install the payer/facilitator dependencies explicitly alongside the candidates:

```bash
npm install --save-exact @x402/core@2.27.0 @x402/stellar@2.27.0
```

The upstream `@x402/stellar/exact/client` and `/exact/facilitator` entrypoints
provide the payer and facilitator; `@x402/core/facilitator` coordinates the latter.
Use an upstream canonical payer for this workflow: Ackrate's mandate
payer intentionally refuses canonical exact offers. The upstream facilitator code
was run locally with a disposable funded sponsor and real Testnet settlement, as
recorded in the [dated evidence](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/npm-workflow-evidence-2026-09-27.md); a fake
facilitator fixture or parsed response header alone does not prove settlement.

## Offline signing coordination and cryptography

The [CLI ops workflow](../packages/cli/README.md#two-signature-coordination)
accepts a Testnet authority manifest. Include the authority's master key among
its three listed custodians. Create and verify a request, independently sign the
same Testnet envelope twice, combine it, and verify the original transaction hash
and exactly two signatures. These commands do not submit governance changes.

SD-JWT cryptographic verification is network-independent. Test the installed
`@ackrate/ap2/sd-jwt` subpath separately from on-chain AP2 admission.

Contract deployments, upgrades, authority rotations and hosted app/device testing
have separate lifecycles. The [historical contract playbook](playbook-testnet.md)
is not an npm quickstart. See [current workflow evidence and remaining limits](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/npm-workflow-evidence-2026-09-27.md)
before declaring a release ready.
