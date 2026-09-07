# Mainnet CLI workflow

The prepared `@ackrate/cli@0.2.1` patch retains Stellar Mainnet as the default
and bundles the official deployment manifest for
[CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).
No separate manifest download or manual contract-address entry is needed.
Signatures, user-approved spending limits, and `--confirm-real-usdc` remain
required for real-value actions. A configured default is not payment permission.

The installed command is `ackrate`. Implemented workflows include `init`,
`setup`, `mandate create`, `pay`, `settlement reconcile`, exact-hash settlement
acknowledgment, two-signature `ops` coordination, and `demo research-agent`.

## Release status

CLI `0.2.0`, Stellar `0.3.0`, Core `0.4.0`, AP2 `0.4.0`, and middleware
`0.3.0` are **published and verified**. On **2026-09-07 Bangkok (UTC+7)**,
the combined public install passed strict TypeScript, ESM imports, default
Mainnet contract, full V2 interface, packed README, and CLI confirmation-guard
checks at **04:25:11**, with zero dependency findings. Registry `latest` tags and
downloaded archive SHA-512 integrity values matched at **04:25:38–04:25:45**.
See the [dated Step 1 release evidence](t3-step-1-gate-2026-09-07.md).

The current patch candidates are Core `0.4.1` and CLI `0.2.1`. Core repairs
shared exact-receipt recovery and retains uncertain settlements when RPC network
or history evidence is invalid. The rebuilt CLI includes those repairs and
durable, cross-process containment for interrupted reference demos. Stellar,
AP2, and middleware retain their previously published versions.

These patches are prepared for publication; this page does not assert that
they are published or that the new live reference-agent run has passed. The
dated `0.4.0`/`0.2.0` results above do not certify these new archives. Verify the
new public archives before recording acceptance from the pinned command below.

For history, the earlier **03:33 Bangkok** checkpoint had CLI `0.1.9`, Stellar
`0.2.5`, Core `0.3.4`, AP2 `0.3.2`, and middleware `0.2.4`. Those older packages
do not acquire the new defaults merely because they remain installed. The CLI
embeds library output at bundle time; installing a newer standalone library
cannot rewrite an older CLI bundle.

The verified package name is `@ackrate/cli`, and its installed executable is
`ackrate`. The project owner approved using the ACKRATE name and this scoped
package in the grant submission on September 7, 2026. This naming update does
not change the Mainnet payment or reference-agent acceptance requirements. Follow the
[release matrix](ackrate-sdk-npm.md) for dated publication evidence.

## Build the current source

Use Node.js 22 or newer. The coordinated source pins
`@stellar/stellar-sdk@16.3.0`.

```bash
npm ci
npm run build
npm run cli:bundle
node packages/cli/dist/ackrate-cli.bundle.mjs --help
```

Build the libraries before bundling. Help and demo listing do not start a
merchant server or payment. The full [release gate](ackrate-sdk-npm.md#clean-package-gate-check)
also checks real package archives in independent clean consumers.

## Run the Mainnet reference agents

Prepare three distinct existing G accounts: a USDC-funded user, an authorized
agent, and the verified merchant. For the example below, the user needs at least
0.03 sendable Circle USDC and the merchant needs at least 0.03 authorized USDC
receiving capacity. The user and agent each need at least 0.50 spendable XLM
above reserves, sponsorship obligations, and selling liabilities, plus named
Stellar CLI signing identities. A secret manager must inject the matching
agent key for detached HTTP proof signing into `ACKRATE_AGENT_SECRET`.
The flag below names that variable; never substitute its secret value.

Replace the example identity names and `G...` with your configured values.
This command authorizes and spends real USDC:

```bash
node packages/cli/dist/ackrate-cli.bundle.mjs demo research-agent \
  --network mainnet \
  --user-signer ackrate-user --agent-signer ackrate-agent \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant G... \
  --price 0.01 --budget 0.03 --confirm-real-usdc
```

The official Mainnet manifest is already bundled. Advanced integrations may
pass `--manifest ./mainnet-deployment.json`; that optional complete record must
validate against the same official deployment, not select an arbitrary address.

The command starts the reference fulfillment server, registers a mandate,
approves only the registry to spend USDC, and has the consumer buy three sources.
Each delivered source follows HTTP 402, on-chain `execute_payment`, independent
bound-proof verification, and HTTP 200. The contract must reject purchase four
without payment. The reference server serves deterministic research content;
the hosted app's external marketplace acceptance is a separate check.

Unsigned preflight checks verify network, registry state, distinct actors,
USDC authorization and sending/receiving capacity, and spendable XLM fee
headroom. These reads do not reserve funds or guarantee future fees. The fully
configured demo command is a real purchase, not a read-only readiness check.

The current release-specific command is pinned below with the same options.
Run it only after `@ackrate/cli@0.2.1` has been published and its public archive
has passed the installation and configuration checks. The self-contained CLI
must be rebuilt from the repaired Core `0.4.1`; installing a newer standalone
core cannot update the old `0.2.0` CLI bundle.

```bash
npx --yes @ackrate/cli@0.2.1 demo research-agent \
  --network mainnet \
  --user-signer ackrate-user --agent-signer ackrate-agent \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant G... \
  --price 0.01 --budget 0.03 --confirm-real-usdc
```

Public installation and configuration checks for this patch are still required.
Release evidence is distinct from a new live-payment run: retain the resulting
transaction and delivery receipts when exercising the reference-agent workflow.
Use the [current-run evidence checklist](mainnet-live-usdc-evidence.md#evidence-required-for-a-new-step-3-run)
to record the exact release, delivered output, finalized transfers, state/balance
agreement, and fourth-purchase rejection. A local bundle run establishes only
that source candidate's behavior.

If the reference demo is interrupted, preserve its run marker and protected
receipt/outcome files. The demo and persistent payment commands share one
atomic journal claim, so neither can replace an unresolved demo. Reconciliation
prints its retained context and exact recovery paths; payment acknowledgment
cannot clear a demo marker. Automatic demo resume is not implemented: manual
recovery must preserve the original receipt, delivery origin, and accepted
application outcome before any replacement run is considered.

## Persistent project and recovery

```bash
ackrate init \
  --user-signer ackrate-user --agent-signer ackrate-agent \
  --merchant G... --price 0.01 --budget 0.03
ackrate setup
ackrate mandate create --confirm-real-usdc
ackrate pay --confirm-real-usdc
ackrate settlement reconcile
ackrate settlement acknowledge <EXACT_CONFIRMED_TX_HASH>
```

`setup` is read-only. Registration and USDC allowance approval are distinct
user-authorized transactions. The allowance belongs to the contract, never the
agent or SDK, and each spend remains subject to atomic on-chain enforcement.

Before broadcast, the CLI durably records the signed hash and validity window,
including syncing the journal's parent directory before preparation returns.
Concurrent processes using the same state cannot pay around its pending lock.
Reconcile the original transaction after uncertainty; do not submit a second
payment or delete the journal. A confirmed success requires explicit
acknowledgment of that exact transaction hash before the payment path reopens.
An interrupted journal operation, incomplete marker, or malformed RPC history
stays locked for manual review; none is treated as proof that payment did not
occur.

See the [complete command and two-signature guide](../packages/cli/README.md)
for signer setup, local state, and governed transaction coordination.

## Contract and acceptance evidence

The [five-package configuration map](mainnet-configuration.md) and
[Mainnet deployment README](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
link the canonical address, source, and artifact. Authorized upgrades replace
the implementation at the same contract address; compatibility and release
evidence still need review after implementation changes.

Historical Mainnet direct-payment transactions, rejection evidence, and the
recipient balance delta remain in
[`mainnet-live-usdc-evidence.md`](mainnet-live-usdc-evidence.md). Those receipts
do not prove completion of the newer reference-agent HTTP flow. Retain a new
run's delivery receipts and transaction evidence before marking that acceptance
check complete. Publication, public clean installation, and live delivery are
separate checks.

`npm run verify:mainnet-evidence` checks the historical old-registry canary only.
Its success does not verify WR/V2 or close current CLI/reference-agent acceptance.
