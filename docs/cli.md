# CLI tool

Implemented commands: `init`, `setup`, `mandate create`, `pay`, `settlement
reconcile`, `settlement acknowledge <TX_HASH>`, and `demo research-agent`. Before
broadcast, the CLI durably records the signed hash and validity window; another
process cannot pay until exact-hash reconciliation closes uncertainty. The demo
creates testnet actors, registers and funds a real mandate, settles three purchases,
then proves the fourth is rejected by the contract budget.

## Evidence

```bash
npx --yes reapp-protocol-cli@0.1.8 demo research-agent
```

The package installs both `reapp` and `reapp-protocol-cli` command names. The
roadmap's proposed unscoped npm name `reapp-cli` is owned by an unrelated
publisher, so the canonical REAPP package is `reapp-protocol-cli`.

The bounded mainnet USDC entrypoint is:

```bash
npx --yes reapp-protocol-cli@0.1.8 demo research-agent --network mainnet
```

It opens the hosted Freighter-authorized reference flow. The user approves a
0.03 USDC mandate, each `agent.fetch()` purchase settles 0.01 USDC through the
verified mainnet MandateRegistry, and the fourth purchase is rejected by the
contract budget.
