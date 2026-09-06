# @ackrate/stellar 0.3.0

The Stellar Mainnet configuration, contract client, wallet-signing interface,
and USDC helpers for Ackrate.

Mainnet MandateRegistry:
[`CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR`](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).

This is the stable contract address used by the coordinated Ackrate packages.
Authorized same-address upgrades replace its implementation, not its address.
Implementation changes still require compatibility checks and updated release
evidence. The contract, not this package, enforces each payment.

## Install

```bash
npm install --save-exact @ackrate/stellar@0.3.0 @stellar/stellar-sdk@16.3.0
```

Requires Node.js 22 or newer. See the
[coordinated release status](https://github.com/ackrate/ackrate-protocol/blob/main/docs/ackrate-sdk-npm.md)
for publication and clean-install verification. Most applications should start
with [`@ackrate/core`](https://www.npmjs.com/package/@ackrate/core).

## Mainnet configuration

`MAINNET` provides the official registry address, public-network passphrase,
RPC configuration, canonical Circle USDC identity, and validated deployment
metadata. You do not need to copy the contract ID into application code.

```ts
import { MAINNET, MAINNET_DEPLOYMENT_MANIFEST } from "@ackrate/stellar";

console.log(MAINNET.mandateRegistryId);
console.log(MAINNET.settlementAsset.contractId); // Canonical Stellar USDC.
console.log(MAINNET_DEPLOYMENT_MANIFEST);        // Public deployment evidence.
```

The [canonical configuration source](https://github.com/ackrate/ackrate-protocol/blob/main/packages/stellar/src/deployments.ts)
records registry version `0.4.1`, schema `2`, source revision
`02d43f5358aa567447447e44407546b6c7de1683`, and original deployment WASM SHA-256
`982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62`.
The [Mainnet deployment record](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
links the deployment transactions, contract source, and release artifact.

Configuration is not a live-chain check or permission to spend. Before a
real-USDC operation, verify the selected deployment, asset, current contract
state, signer accounts, balances, and intended budget. XLM pays transaction fees.

## Read a balance

```ts
import { MAINNET, token } from "@ackrate/stellar";

const balance = await token.balance(
  MAINNET,
  MAINNET.settlementAsset.contractId,
  walletAddress,
);
console.log(balance); // Integer amount; Stellar USDC has 7 decimal places.
```

`walletAddress` is the public address supplied by your connected wallet. This
read simulates a contract call; it does not sign or submit a transaction.

## Contract and wallet APIs

| Export | Purpose |
|---|---|
| `MAINNET` | Ready-to-use official Mainnet network configuration. |
| `MAINNET_DEPLOYMENT_MANIFEST` | Complete bundled public deployment record. |
| `DEPLOYMENTS.mainnet` | Registry identity, artifact fingerprints, and evidence links. |
| `publishedMainnetNetworkFromDeploymentManifest(manifest)` | Validate a complete supplied manifest against the pinned official deployment identity. |
| `registryClient(network, signer)` | Create a typed contract client using an explicit network and wallet signer. |
| `StellarSigner` | External signing interface; user-controlled keys stay outside the application. |
| `stellarSigner(input, passphrase)` | Normalize an external signer or managed key into that interface. |
| `keypairSigner(keypair, passphrase)` | Adapt a securely managed Stellar keypair. |
| `token.balance`, `token.authorized`, `token.decimals` | Read token balance, account authorization, and decimals. |
| `token.approve` | User-signed SEP-41 allowance; the spender must be the registry, never the agent. |

The payment interface supports `register_mandate`, `get_mandate`,
`validate_mandate`, `execute_payment`, and `revoke_mandate`. An agent payment
must call `execute_payment`; a read-only validation cannot replace settlement.
The contract revalidates and consumes the mandate atomically with its transfer.

`StellarSigner` requires the wallet public key and `signTransaction`; it can
also provide `signAuthEntry` and detached `signPayload`. Paid x402 requests need
detached agent signing to bind the exact HTTP challenge to the settlement proof.
A transaction-only signer can make direct payments but cannot produce that
proof. Keep secrets in a wallet or secret manager, never source code or logs.

For user setup and crash-safe payments, use the
[Core workflow](https://github.com/ackrate/ackrate-protocol/blob/main/packages/sdk/README.md).
For governed operations, use the
[Mainnet contract guide](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
and the CLI's two-signature coordination commands.

Apache-2.0.
