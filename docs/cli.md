# CLI workflow

The installed command is `ackrate`. The [package README](../packages/cli/README.md)
is the canonical guide for installation, Mainnet prerequisites, persistent
projects, exact-hash reconciliation, setup-registration recovery, the reference
research agent, and two-signature coordination.

For disposable funded actors, use the explicit [Testnet workflow](testnet-workflows.md).
Mainnet is the CLI default; an omitted network flag is not a Testnet shortcut.

## Build from source

Use Node.js 22 or newer:

```bash
npm ci
npm run build
npm run cli:bundle
node packages/cli/dist/ackrate-cli.bundle.mjs --help
```

The CLI embeds library output at bundle time. Installing a newer standalone
core package does not update an older CLI bundle.

## Release and evidence

- [Current published versions and candidates](ackrate-sdk-npm.md#release-matrix).
- [September 27 package workflow validation](npm-workflow-evidence-2026-09-27.md).
- [September 7 coordinated release](t3-step-1-gate-2026-09-07.md).
- [September 7 independent Mainnet receipts](cli-mainnet-independent-receipts-2026-09-07.json).

`verify:mainnet-evidence` checks a historical canary; it does not execute the
current CLI or prove a new payment. Recovery of a successful registration after
allowance setup failed is Mainnet-only. It is distinct from payment recovery,
and automatic reference-demo resume is not implemented.
