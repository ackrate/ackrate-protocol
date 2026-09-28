# Contract source of truth

## Ownership

`ackrate-protocol` owns TypeScript SDKs, CLI, reference agents, and their docs.
[`ackrate-protocol-contracts`](https://github.com/ackrate/ackrate-protocol-contracts)
owns Rust implementations, contract tests, builds, releases and deployment gates.

The former `contracts/mandate-registry` started in the protocol monorepo in
[`a77d76c`](https://github.com/ackrate/ackrate-protocol/commit/a77d76c), then gained
composite pools. It remained wired into CI and the Testnet deployment helper
after dedicated contract releases moved to the contracts repo. It is not the
Mainnet V2 source and differs from the maintained composite implementation.
Its complete tracked tree at protocol revision `9a41cfa` is preserved unchanged
in the contracts repo under `contracts/legacy-protocol/mandate-registry`, including
tests, snapshots and Cargo.lock. Contract CI there retains its Rust checks.
The SDK repo no longer owns or publishes a second Rust implementation. Its
required `mandate-registry (Rust)` CI status checks a pinned contracts-repo
revision so branch protection and contract regressions remain enforced.

## Mainnet deployment

The authoritative deployment mapping is the contracts repo's
[Mainnet V2 record](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md).
The SDK's [`deployments.ts`](../packages/stellar/src/deployments.ts) bundles that
public identity for consumers; it does not establish current chain state.

| Evidence | Value |
|---|---|
| Mainnet registry | `CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR` |
| Source | [`contracts/mainnet-v2/mandate-registry` at `02d43f5358aa567447447e44407546b6c7de1683`](https://github.com/ackrate/ackrate-protocol-contracts/tree/02d43f5358aa567447447e44407546b6c7de1683/contracts/mainnet-v2/mandate-registry) |
| Source tag | `mainnet-v2-v0.4.1` |
| WASM SHA-256 | `982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62` |
| Exact release artifact | [mandate-registry v0.4.1](https://github.com/ackrate/ackrate-protocol-contracts/releases/download/v2-source-verify-v0.4.1.6_mandate-registry_pkg0.4.1_cli27.0.0/mandate-registry_v0.4.1.wasm) |
| Deployment transaction | [`28df0baa…61cd`](https://stellar.expert/explorer/public/tx/28df0baad437bde0409cebe002c528d3f6a3306dd1e0671a15fa1c4c47b961cd) |
| Administrator | `GCIURCX7JHEKQLRTW6RDZU7OJUVCDM7WWNQPIKRERIHQOHSLW7UY7TXG` |

A read-only `getLedgerEntries` check against `https://mainnet.sorobanrpc.com`
on 2026-09-28 at ledger **64656887** returned the exact WASM hash above,
the same administrator, `SchemaVersion = 2`, and `Paused = false`.
This is a dated chain-state observation, not payment or custody acceptance.
Current executable bytes on chain are the runtime authority; after any upgrade,
compare the current hash with the reviewed release and update the deployment record.

The older `contracts/mainnet/deployment-manifest.json` describes the separate
`CDBTG…PAGS` timelock canary. It must not be substituted for the V2 identity.
Likewise, branch `v3mainnet` is a separate historical checkout, not evidence of
what the published SDK targets. Use an immutable source revision and release
hash rather than guessing from a branch name.

## Testnet development after relocation

Check out the contracts repository including `contracts/legacy-protocol`, then:

```sh
ACKRATE_CONTRACTS_ROOT=/absolute/path/to/ackrate-protocol-contracts npm run deploy:testnet
```

This builds the preserved legacy variant and writes its experimental address to
`.env`; it does not change the SDK Mainnet default. The helper requires the Testnet
network passphrase. Run Rust tests in the contracts checkout and `npm run verify`
in this SDK checkout. Use the contracts repository's Mainnet V2 deployment and
release gates for Mainnet work.

## Security documentation

Protocol security records now live in [`docs/security`](security/README.md).
They include current threat models and historical point-in-time agent reviews;
review records are not independent proof of current Mainnet safety.
