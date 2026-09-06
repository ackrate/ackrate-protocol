# Mainnet CLI workflow

The coordinated `@ackrate/cli@0.2.0` release makes Stellar Mainnet the default
and bundles the official deployment manifest for
[CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).
No separate manifest download or manual contract-address entry is needed.
Signatures, user-approved spending limits, and `--confirm-real-usdc` remain
required for real-value actions. A configured default is not payment permission.

The installed command is `ackrate`. Implemented workflows include `init`,
`setup`, `mandate create`, `pay`, `settlement reconcile`, exact-hash settlement
acknowledgment, two-signature `ops` coordination, and `demo research-agent`.

## Release status

At the **2026-09-07 03:33 Bangkok (UTC+7)** registry checkpoint, the public CLI
was `@ackrate/cli@0.1.9`. Public libraries were Stellar `0.2.5`, Core `0.3.4`,
AP2 `0.3.2`, and middleware `0.2.4`.

The new coordinated candidates—CLI `0.2.0`, Stellar `0.3.0`, Core `0.4.0`,
AP2 `0.4.0`, and middleware `0.3.0`—are **pending publication and public
clean-install verification**. Their new defaults are not present merely because
an older package is installed. The CLI embeds library output at bundle time;
installing a newer standalone library cannot rewrite an older CLI bundle.

The package name is `@ackrate/cli`, not the unrelated publisher's `ackrate-cli`.
Earlier grant wording used a retired unscoped CLI name; record the package-name
change in the submission. Follow the [release matrix](ackrate-sdk-npm.md) for
dated publication evidence.

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

Prepare three distinct existing accounts: a USDC-funded user, an authorized
agent, and the verified merchant. The user and agent need XLM fee headroom and
named Stellar CLI signing identities. A secret manager must inject the matching
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

After publication and clean-install verification, run the same options with
the pinned npm command:

```bash
npx --yes @ackrate/cli@0.2.0 demo research-agent \
  --network mainnet \
  --user-signer ackrate-user --agent-signer ackrate-agent \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant G... \
  --price 0.01 --budget 0.03 --confirm-real-usdc
```

This exact npm version remains pending until the release matrix records its
publication. A successful local build is not public registry or live-payment evidence.

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

Before broadcast, the CLI durably records the signed hash and validity window.
Concurrent processes using the same state cannot pay around its pending lock.
Reconcile the original transaction after uncertainty; do not submit a second
payment or delete the journal. A confirmed success requires explicit
acknowledgment of that exact transaction hash before the payment path reopens.

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
