# CLI tool

Implemented commands: `init`, `setup`, `mandate create`, `pay`, `settlement
reconcile`, `settlement acknowledge <TX_HASH>`, and `demo research-agent`. Before
broadcast, the CLI durably records the signed hash and validity window; another
process cannot pay until exact-hash reconciliation closes uncertainty. The demo
creates testnet actors, registers and funds a real mandate, settles three purchases,
then proves the fourth is rejected by the contract budget. Its explicit mainnet
mode consumes only a complete verified deployment manifest, canonical Circle
USDC, named external Stellar CLI identities, and a visible real-value confirmation.

## Evidence

```bash
npx --yes @ackrate/cli@0.1.9 demo research-agent --network testnet
```

The package installs the `ackrate` command. The
roadmap's proposed unscoped npm name `ackrate-cli` is owned by an unrelated
publisher, so the canonical Ackrate package is `@ackrate/cli`.

Friday's bounded canary uses the completed deployment manifest without a source
edit:

```bash
npx --yes @ackrate/cli@0.1.9 demo research-agent \
  --network mainnet --manifest ./mainnet-deployment.json \
  --user-signer ackrate-canary-user --agent-signer ackrate-canary-agent \
  --merchant G... --price 0.01 --budget 0.03 --confirm-real-usdc
```
