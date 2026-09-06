# Mainnet contract and npm package configuration

Official ACKRATE Mainnet MandateRegistry:

**[CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR)**

The coordinated release below makes this the default Mainnet contract. Its
complete deployment manifest is bundled: no manual address entry or separate
manifest file is needed. This is the registry address, not the agent, merchant,
or USDC token address. Authorized upgrades replace the implementation at this
same address; compatibility and deployment evidence still require review when
the implementation changes.

The [contract's Mainnet README](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
records the deployment transactions, source revision, artifact identity, and
native 2-of-3 governance profile.

## How the five packages use this contract

| Coordinated package | Configuration mapping |
|---|---|
| [@ackrate/stellar 0.3.0](https://www.npmjs.com/package/@ackrate/stellar) | Exports `MAINNET`, `MAINNET_DEPLOYMENT_MANIFEST`, and the canonical `DEPLOYMENTS.mainnet.mandateRegistryId`. The complete bundled profile supplies network, registry, USDC, and deployment evidence. |
| [@ackrate/core 0.4.0](https://www.npmjs.com/package/@ackrate/core) | Requires Stellar `^0.3.0`. Defaults its mandate and payment APIs to the official profile exposed as `ackrate.mainnet`. |
| [@ackrate/ap2 0.4.0](https://www.npmjs.com/package/@ackrate/ap2) | Requires Core `^0.4.0`. Validates and bridges signed intents into the Core Mainnet flow; AP2 has no independent network configuration or money-moving route. |
| [@ackrate/express-middleware 0.3.0](https://www.npmjs.com/package/@ackrate/express-middleware) | Requires Core `^0.4.0` and Stellar `^0.3.0`. The merchant verifier uses the same official registry and canonical Mainnet USDC; examples pass `networkConfig: MAINNET` explicitly. |
| [@ackrate/cli 0.2.0](https://www.npmjs.com/package/@ackrate/cli) | Bundles the updated implementation and official manifest. Mainnet is the default; `--manifest` is an optional validated override for the same official deployment. Signers and real-USDC confirmation remain required. |

All five versions above are **published and verified**. A fresh public install
passed at **2026-09-07 04:25:11 Bangkok (UTC+7)**; registry `latest` tags and
downloaded archive SHA-512 identities matched at **04:25:38–04:25:45**. See the
[Step 1 release evidence](t3-step-1-gate-2026-09-07.md) and
[npm release matrix](ackrate-sdk-npm.md#release-matrix). Older releases remain
historical versions, not interchangeable evidence for these defaults or exports.

## Use the official configuration

Install the published packages with Node.js 22 or newer:

```bash
npm install --save-exact @ackrate/stellar@0.3.0 @ackrate/core@0.4.0 @stellar/stellar-sdk@16.3.0
```

Read the shared configuration:

```ts
import { MAINNET, MAINNET_DEPLOYMENT_MANIFEST } from "@ackrate/stellar";
import { ackrate } from "@ackrate/core";

console.log(MAINNET.mandateRegistryId);
console.log(ackrate.mainnet.mandateRegistryId);
console.log(MAINNET.settlementAsset.contractId); // Canonical Stellar USDC.
console.log(MAINNET_DEPLOYMENT_MANIFEST);        // Public deployment evidence.
```

Both registry values are:

```text
CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR
```

The identity is maintained in
[`packages/stellar/src/deployments.ts`](../packages/stellar/src/deployments.ts),
with the public package exports documented in the
[Stellar README](../packages/stellar/README.md#mainnet-configuration).
Core and middleware consume that configuration; the CLI embeds it when built.
Updating an installed library does not rewrite an older CLI bundle.

## Advanced: validate a supplied manifest

The bundled official profile is sufficient for normal use. Integrations that
deliberately supply a manifest can validate it against the same pinned identity:

```ts
import { publishedMainnetNetworkFromDeploymentManifest } from "@ackrate/stellar";

const network = publishedMainnetNetworkFromDeploymentManifest(suppliedManifest);
```

The supplied object must be a complete deployment record. The helper rejects a
different registry, source, artifact identity, or deployment receipt; an address
alone is not enough. The CLI's optional `--manifest` uses this official-identity
check rather than silently selecting another contract.

## Authorization and governance

Mainnet uses real USDC and XLM network fees. Loading configuration or validating
a manifest does not sign, submit, approve an allowance, reserve funds, or verify
the current chain state. Verify current deployment state and balances, and
obtain the user's approval of the merchant, cap, and expiry before setup.
Agent payments still require signatures and the contract's atomic
`execute_payment` checks. The token allowance belongs to the contract, never
the agent or SDK.

Current V2 uses native Stellar 2-of-3 administrator authorization and requires
paused state for an upgrade. It has no integrated timelock. The older
OpenZeppelin/timelock canary and delayed-upgrade development contracts remain
separately documented historical profiles, not this default configuration.
