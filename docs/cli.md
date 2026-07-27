# CLI tool

Implemented commands: `init`, `setup`, `mandate create`, `pay`, `settlement
reconcile`, `settlement acknowledge <TX_HASH>`, and `demo research-agent`. Before
broadcast, the CLI durably records the signed hash and validity window; another
process cannot pay until exact-hash reconciliation closes uncertainty. The demo
creates testnet actors, registers and funds a real mandate, settles three purchases,
then proves the fourth is rejected by the contract budget.

## Evidence

```bash
npx --yes reapp-protocol-cli@0.1.7 demo research-agent
```

The package installs both `reapp` and `reapp-protocol-cli` command names. The
roadmap's proposed unscoped npm name `reapp-cli` is owned by an unrelated
publisher, so the canonical REAPP package is `reapp-protocol-cli`.
