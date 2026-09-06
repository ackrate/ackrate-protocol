# CLI tool

Implemented commands: `init`, `setup`, `mandate create`, `pay`, `settlement
reconcile`, `settlement acknowledge <TX_HASH>`, and `demo research-agent`. Before
broadcast, the CLI durably records the signed hash and validity window; another
process cannot pay until exact-hash reconciliation closes uncertainty. The demo
creates testnet actors, registers and funds a real mandate, settles three purchases,
then proves the fourth is rejected by the contract budget. Its explicit mainnet
mode consumes only a complete verified deployment manifest, canonical Circle
USDC, named external Stellar CLI identities, and a visible real-value confirmation.

## Reviewer source command

Registry verification on **2026-09-07**: the published CLI is `@ackrate/cli@0.1.9`.
The source candidate `0.1.10` has not been published. The older npm bundle does
not include the current `buyResearch` reference-agent flow. The candidate
requires **Node.js 22+** and exact **`@stellar/stellar-sdk@16.3.0`**. It bundles
the candidate core **0.3.4**, Stellar binding **0.2.5**, and middleware **0.2.5**
implementation; AP2 **0.3.3** is part of the accompanying package release set.

The published package checkpoint is core **0.3.3**, Stellar binding **0.2.4**,
AP2 **0.3.2**, middleware **0.2.4**, and CLI **0.1.9**. Do not attribute the
candidate's V2 manifest or returned-mandate-ID handling to those old packages.
Build this checkout to evaluate the current V2-compatible implementation:

```bash
npm ci
npm run build
npm run cli:bundle
node packages/cli/dist/ackrate-cli.bundle.mjs demo research-agent --network testnet
```

Build the libraries before bundling: the CLI embeds their generated output.
The standalone fulfillment process has a separate entrypoint, so help and demo
listing do not start a merchant server. After publication and clean-install
verification, the corresponding pinned command is:

```bash
npx --yes @ackrate/cli@0.1.10 demo research-agent --network testnet
```

That npm command remains pending until the exact candidate version is published.

The package installs the `ackrate` command. The
roadmap's proposed unscoped npm name `ackrate-cli` is owned by an unrelated
publisher, so the canonical Ackrate package is `@ackrate/cli`.
Earlier deliverable text uses a retired unscoped CLI name. Use the pinned
`@ackrate/cli` package when reviewing a published release, and record the
package naming change in the submission.

The Mainnet reference-agent run requires a completed deployment manifest and
three distinct funded accounts: the user, agent, and merchant. Choose the
verified manifest for the deployment under review; the SDK does not select a
Mainnet contract by default. The user and agent must have named Stellar CLI
identities, and a secret manager must inject the matching agent key into
`ACKRATE_AGENT_SECRET` for detached request-proof signing. The flag below names
the environment variable; never substitute the secret itself into the command.

```bash
node packages/cli/dist/ackrate-cli.bundle.mjs demo research-agent \
  --network mainnet --manifest ./mainnet-deployment.json \
  --user-signer ackrate-canary-user --agent-signer ackrate-canary-agent \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant <merchant-G-address> \
  --price 0.01 --budget 0.03 --confirm-real-usdc
```

The command starts the reference fulfillment server, registers a mandate,
approves only the registry to spend USDC, and has the consumer buy three sources.
Each delivered source follows HTTP 402, on-chain `execute_payment`, bound proof
verification, and HTTP 200. A fourth purchase must fail at the contract without
payment. This reference server serves deterministic content; the hosted app's
external marketplace integration is a separate acceptance check.

Before registration, Mainnet preflight verifies both USDC endpoints are authorized,
uses the current ledger's base reserve and account sponsorship/liability fields
to require at least **0.50 spendable XLM** for both user and agent, and checks
USDC sending capacity and the merchant's receiving limit. These unsigned reads
do not reserve funds or guarantee future fees. Running the fully configured
command is a real purchase, not a read-only preflight command.

The earlier Mainnet direct-payment run, exact transaction links, contract
rejection, and recipient balance delta are published in
[`mainnet-live-usdc-evidence.md`](mainnet-live-usdc-evidence.md). Those historical
transactions do not establish completion of the later bound-v2 reference-agent
HTTP flow; retain a new run's delivery receipts and transaction evidence before
marking that acceptance check complete.

An npm release containing the current source, followed by a clean-install
verification of its exact `npx` command, remains a separate delivery check.
