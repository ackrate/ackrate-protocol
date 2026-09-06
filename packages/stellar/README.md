# @ackrate/stellar 0.2.5

The Soroban layer for **Ackrate**, agent-driven payments on Stellar, enforced
on-chain by the **MandateRegistry** contract.

This package is the low-level building block: a **typed MandateRegistry client**
generated from the contract interface that passed the gate check, published deployment identities and validated network config, a keypair
signing adapter, and minimal SEP-41 token helpers.

> **Most apps want [`@ackrate/core`](https://www.npmjs.com/package/@ackrate/core), not this.**
> `core` wraps these pieces into a mandate-validated payment in under 10 lines.
> Reach for `@ackrate/stellar` when you need direct, typed access to the contract.

## Install

```
npm install @ackrate/stellar@0.2.5 @stellar/stellar-sdk@16.3.0
```

Requires Node.js 22 or newer.

## What it exports

This version accepts verified deployment manifests with schema
1 (separate timelock) or schema 2 (V2 registry under direct 2-of-3 administration).
`mainnetNetworkFromDeploymentManifest` checks the supplied profile, canonical
Circle USDC, registry/artifact identities, constructor arguments, and recorded
verification. Its `release.schemaVersion` identifies the profile; optional
timelock fields are absent for schema 2. Parsing a manifest is not live chain
verification or a claim that V2 has a timelock. Testnet remains the default;
Mainnet requires an explicit validated network configuration.

| Export | What it is |
|---|---|
| `TESTNET` | `NetworkConfig` for Stellar testnet: RPC, passphrase, live MandateRegistry id, native asset |
| `DEPLOYMENTS` | Public Testnet and Mainnet deployment identities; Mainnet metadata is not a spend-ready `NetworkConfig` |
| `publishedMainnetNetworkFromDeploymentManifest(manifest)` | Validate a complete manifest and require the published Mainnet V2 registry, source, artifact, and deployment receipts |
| `mainnetNetworkFromDeploymentManifest(manifest)` | Validate a complete schema 1 or schema 2 Mainnet manifest for an explicitly selected deployment |
| `registryClient(net, signer)` | Factory for the typed MandateRegistry client |
| `Client`, `Mandate`, `PendingUpgrade`, `Errors` | Typed contract bindings generated from the exact `simple-v0.2.3` release WASM |
| `keypairSigner(keypair, passphrase)` | Adapt a Stellar `Keypair` into a transaction signer |
| `token.approve(...)`, `token.balance(...)`, `token.authorized(...)` | Minimal SEP-41 token helpers |

## Published Mainnet V2 identity

`DEPLOYMENTS.mainnet.mandateRegistryId` is
[`CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR`](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).
The profile pins the original deployment manifest: package `mandate-registry`
`0.4.1`, source commit `02d43f5358aa567447447e44407546b6c7de1683`, schema `2`,
and WASM SHA-256
`982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62`.
Its settlement asset is canonical Circle USDC on Stellar Mainnet. The profile
also exports the interface hash, artifact size, deployment ledger, transaction
hashes, authority account, and links to the
[deployment record](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
and reproducible release artifact.

```ts
import {
  DEPLOYMENTS,
  publishedMainnetNetworkFromDeploymentManifest,
} from "@ackrate/stellar";

console.log(DEPLOYMENTS.mainnet.mandateRegistryId); // discovery only
const network = publishedMainnetNetworkFromDeploymentManifest(manifest);
// `manifest` must be the complete independently verified deployment record.
// Re-check current chain state before explicitly authorizing any real-USDC action.
```

The helper does not fetch chain state, sign, register a mandate, approve an
allowance, or move funds. An address alone cannot pass validation. The CLI's
Mainnet workflow still requires a complete manifest, explicit real-USDC
confirmation, and external signing; default SDK and CLI flows remain Testnet.

## Default Testnet identity

`TESTNET.mandateRegistryId` points at the upgradeable simple contract
[`CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM`](https://stellar.expert/explorer/testnet/contract/CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM).
Its on-chain WASM hash is
`ba370a80369daa0a0dea2554410dca6f2a9f7a76ba707cb92a83434e2fe76e87`,
matching the [`simple-v0.2.3` release artifact](https://github.com/ackrate/ackrate-protocol-contracts/releases/tag/simple-v0.2.3_contracts_simple_mandate_registry_mandate-registry_pkg0.2.3_cli25.1.0).
The binding exposes `get_admin`, `set_admin`, `pause`, `unpause`, `is_paused`,
`get_pending_upgrade`, `get_upgrade_delay`, and the one-hour
`schedule_upgrade`, `cancel_upgrade`, and `execute_upgrade` lifecycle alongside
the unchanged mandate interface. Upgrade execution requires current-admin auth,
an elapsed delay, and paused state; the contract ID and storage are preserved.

## Typed contract methods

| Method | Typed input or result |
|---|---|
| `register_mandate` | user, agent, merchant, asset, budget, expiry, and 32-byte mandate id |
| `get_mandate` | mandate id → `Result<Mandate>` |
| `validate_mandate` | mandate id, merchant, amount, and expected sequence → `Result<void>` |
| `execute_payment` | mandate id, amount, and expected sequence → contract-enforced transfer |
| `revoke_mandate` | mandate id → user-authorized revocation |
| `get_admin`, `set_admin` | read or rotate the operational authority |
| `pause`, `unpause`, `is_paused` | control or read the money-path stop state |
| `schedule_upgrade` | new 32-byte WASM hash → earliest execution timestamp |
| `get_pending_upgrade`, `cancel_upgrade` | inspect or cancel the scheduled change |
| `get_upgrade_delay` | fixed `3600n` seconds |
| `execute_upgrade` | same-address code replacement after all three controls pass |

## Example: read a mandate straight from the contract

```ts
import { TESTNET, keypairSigner, registryClient } from "@ackrate/stellar";
import { Keypair } from "@stellar/stellar-sdk";

const signer = keypairSigner(Keypair.fromSecret(SECRET), TESTNET.networkPassphrase);
const registry = registryClient(TESTNET, signer);

const mandate = (await registry.get_mandate({ mandate_id })).result.unwrap();
console.log(mandate.status, mandate.spent); // e.g. Active, 0
```

Operational reads are typed too:

```ts
const admin = (await registry.get_admin()).result;
const paused = (await registry.is_paused()).result;
const delay = (await registry.get_upgrade_delay()).result; // 3600n
```

The contract is the source of truth: every spend is validated and consumed
on-chain by `execute_payment`, so a buggy or malicious client cannot exceed the
mandate. For the full agent → pay flow, use
[`@ackrate/core`](https://www.npmjs.com/package/@ackrate/core).

Apache-2.0.
