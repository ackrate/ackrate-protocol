# @ackrate/cli 0.2.1

Run Ackrate's contract-enforced USDC payment workflow on Stellar Mainnet from
your terminal: configure signers, register a mandate, approve its budget, pay a
merchant, and verify the receipt.

Mainnet MandateRegistry:
[`CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR`](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).

Mainnet is the default. The CLI bundles the official deployment configuration
from `@ackrate/stellar`; you do not need to copy the contract address or download
a separate manifest for this deployment. Authorized upgrades replace the
implementation at this same address. Compatibility and release evidence must
still be checked when that implementation changes.

## Install

```bash
npm install -g @ackrate/cli@0.2.1
ackrate --help
```

Requires Node.js 22 or newer. The installed command is `ackrate`. Check the
[coordinated release status](https://github.com/ackrate/ackrate-protocol/blob/main/docs/ackrate-sdk-npm.md)
for publication and clean-install verification.

## Before you spend

Mainnet operations use real USDC and XLM transaction fees. The CLI never creates
funded accounts or stores new private keys for this workflow. Prepare:

- Existing user, agent, and merchant accounts authorized to use canonical Stellar USDC.
- Enough user USDC for the chosen budget and XLM fee headroom on signing accounts.
- Named user and agent identities in Stellar CLI secure storage or a supported signing device.
- A verified merchant address and explicit price/budget approval.

Use `--confirm-real-usdc` only after reviewing the operation. Selecting Mainnet
or loading its configuration does not authorize a payment by itself.

## Run the reference research agent

Replace the example signer names and `G...` with your configured identities and
merchant address. This bounded run pays `0.01` USDC per source against a `0.03`
USDC mandate, then verifies rejection of a fourth purchase.

```bash
ackrate demo research-agent \
  --network mainnet \
  --user-signer ackrate-user \
  --agent-signer ackrate-agent \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant G... \
  --price 0.01 \
  --budget 0.03 \
  --confirm-real-usdc
```

`ACKRATE_AGENT_SECRET` is an environment-variable **name**. Inject its value
from a secret manager; never put a secret in command arguments, source, or logs.
The research demo needs detached agent signing for its bound HTTP payment proof,
in addition to the named transaction signer. The named identity and injected key
must represent the same agent.

The reference consumer and fulfillment agents run the HTTP 402 → on-chain
payment → verified proof → delivered JSON flow. Success requires three durable
receipts matching three delivered resources, consistent budget/sequence and
merchant balance, and a fourth purchase rejected without payment. No LLM API
key is needed: this command demonstrates the payment and delivery path.

The official manifest is bundled. `--manifest ./mainnet-deployment.json` remains
available when you deliberately supply a complete deployment record; it must
match the same official deployment and pass validation. The CLI rejects wrong-network RPCs, incomplete evidence,
conflicting USDC identities, paused contracts, missing or reused actor accounts,
insufficient balances, and invalid demo price/budget combinations.

An interrupted reference demo keeps a durable run marker in the same atomic
claim used by `pay`. A new demo or payment cannot replace it. Preserve the
original receipts, outcomes, and delivery origin; `settlement reconcile` reports
their retained context for manual exact-receipt recovery. Automatic demo resume
is not implemented, and payment acknowledgment cannot clear a demo marker.

For a registration that succeeded before allowance signing failed, an operator
can preserve the old journal and explicitly recover **that same registration**
in a separate, private `ACKRATE_HOME` by adding
`--resume-setup-registration <confirmed-registration-transaction-hash>` to the
command above. This is not general payment recovery: the confirmed Mainnet
transaction, exact actors/asset/budget/credential, unchanged payer sequence,
active unexpired mandate and zero spent/sequence must all match. Registration is
not repeated and expiry is not extended. Real-USDC confirmation is still
required. This narrow path needs at least 0.05 spendable payer XLM for allowance
setup; the normal payer and agent fee floors remain 0.50 XLM. These floors are
readiness checks, not guaranteed future transaction fees. Do not use this option
after any payment or allowance has applied or while another process is active.

## Use a persistent project

```bash
ackrate init \
  --user-signer ackrate-user \
  --agent-signer ackrate-agent \
  --merchant G... \
  --price 0.01 \
  --budget 0.03
ackrate setup
ackrate mandate create --confirm-real-usdc
ackrate pay --confirm-real-usdc
ackrate settlement reconcile
ackrate settlement acknowledge <TX_HASH>
```

`init` writes the public project configuration. `setup` performs read-only
account, balance, asset, RPC, and registry checks. Mandate creation has two
distinct user-authorized operations: register the mandate, then approve the
registry's token allowance. The allowance goes to the **contract**, never the
agent or CLI. A budget is a cap, not an upfront deposit.

`pay` is agent-signed. The contract checks the stored mandate and atomically
consumes its budget/sequence with the USDC transfer. A cached mandate or an SDK
preflight cannot replace the on-chain `execute_payment` path.

## Recover a pending payment

Before broadcast, the CLI signs, derives the exact transaction hash and validity
window, and fsyncs a private journal and its parent directory. An atomic local claim prevents concurrent
CLI processes using the same state from submitting a second payment.

If confirmation is uncertain, do not retry as a new payment:

```bash
ackrate settlement reconcile
ackrate settlement acknowledge <EXACT_CONFIRMED_TX_HASH>
```

Reconciliation queries the original hash without another signature or payment.
A confirmed success remains blocked until you explicitly acknowledge that exact
transaction. A proven failure, or a provably expired transaction within retained
RPC history, can be cleared without acknowledging a payment that never landed.
Unknown results stay locked. Protect the journal and do not delete it to bypass
an unresolved purchase. Incomplete markers, interrupted journal operations, and
invalid RPC history also remain locked for manual review.

## Commands

| Command | Purpose |
|---|---|
| `ackrate init` | Create an official Mainnet project; optional `--manifest` selects a validated supplied record. |
| `ackrate setup` | Run read-only readiness checks for the configured project. |
| `ackrate mandate create [-b <amount>] [-e <seconds>] [--confirm-real-usdc]` | Register a budget/expiry mandate and approve the registry allowance. |
| `ackrate pay [amount] [--confirm-real-usdc]` | Submit an agent-signed mandate-validated USDC payment. |
| `ackrate settlement reconcile` | Resolve the existing journal's exact transaction hash. |
| `ackrate settlement acknowledge <tx-hash>` | Accept one exact confirmed success and reopen the payment path. |
| `ackrate demo research-agent` | Run the bounded consumer/fulfillment reference flow with the required signer and spending options. |
| `ackrate ops create` | Bind an unsigned authority transaction to a signing request. |
| `ackrate ops verify` | Independently verify its network, hash, source, and exact contract call. |
| `ackrate ops combine` | Combine exactly two different valid custodian signatures. |

Use `ackrate <command> --help` for command-specific options. `-f` permits
replacement only where supported; it does not bypass unresolved settlement
state or the real-USDC confirmation guard.

## Two-signature coordination

The `ops` commands coordinate already prepared governed operations, such as an
authorized pause or upgrade. They do not construct arbitrary safe governance
transactions for you, accept custodian secrets, or execute a change merely by
combining signatures. First build and simulate the exact intended invocation
using the [Mainnet contract guide](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md).

Fill the public addresses in
[`examples/mainnet-authority-manifest.template.json`](examples/mainnet-authority-manifest.template.json),
then create the review request:

```bash
ackrate ops create --xdr unsigned.xdr --manifest mainnet-authority.json --out request.json
ackrate ops verify --request request.json
```

Each custodian independently verifies the request and signs the unchanged XDR
using their own secure identity. The coordinator combines the two signed files:

```bash
ackrate ops combine \
  --request request.json \
  --signed signed-a.xdr signed-b.xdr \
  --out ready.xdr
```

Duplicate, unknown, wrong-network, changed-payload, and mixed-request signatures
are rejected. Before authorized submission, both custodians verify that the
combined envelope's hash still equals the request hash. Keep private signer
stores and recovery material on independently controlled devices.

## Local files

| File | Purpose | Safe to commit? |
|---|---|---:|
| `ackrate.config.json` | Public Mainnet configuration, deployment identity, and signer names. | Yes, after checking for accidentally added secrets. |
| `~/.ackrate/mandate.json` | Active mandate and setup transaction references. | No. |
| `~/.ackrate/pending-settlement/state.json` | Prepared hash, sequence, and validity window until reconciliation. | No. |

`ACKRATE_HOME` can relocate private CLI state. All processes sharing an account's
workflow must use coordinated durable state; separate directories are not a safe
way to run concurrent payments against an unresolved mandate.

## Configuration and source

The CLI bundles [`@ackrate/core`](https://www.npmjs.com/package/@ackrate/core)
and [`@ackrate/stellar`](https://www.npmjs.com/package/@ackrate/stellar).
The [canonical deployment configuration](https://github.com/ackrate/ackrate-protocol/blob/main/packages/stellar/src/deployments.ts)
maps the coordinated packages to the Mainnet registry above. See its
[deployment evidence](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
or see the [hosted wallet project](https://github.com/ackrate/ackrate-protocol-demo).

Apache-2.0.
