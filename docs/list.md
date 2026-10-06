# Ackrate documentation index

Package status is maintained in the [release matrix](ackrate-sdk-npm.md); live
workflow results are in [September 27 evidence](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/npm-workflow-evidence-2026-09-27.md).

## Start here

| Document | Purpose |
|---|---|
| [`testnet-workflows.md`](testnet-workflows.md) | Installed CLI, SDK/AP2, local Express, recovery, canonical x402 and offline signing. |
| [`playbook-testnet.md`](playbook-testnet.md) | Historical contract release and operating procedure. |
| [`mainnet-roadmap.md`](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/mainnet-roadmap.md) | Contract, custody, SDK, CLI, agent, wallet, security, and evidence gates for mainnet. |
| [`mainnet-mandate-registry-plan.md`](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/mainnet-mandate-registry-plan.md) | Deep design and one-step execution plan for the first mainnet MandateRegistry workstream. |

## Protocol and implementation

| Document | Purpose |
|---|---|
| [`mandate-registry-contract.md`](mandate-registry-contract.md) | Current contracts, controls, methods, errors, releases, and verification. |
| [`x402-roundtrip.md`](x402-roundtrip.md) | Bound-v2 challenge, proof, chain verification, recovery, and stores. |
| [`wallet-chat-application.md`](wallet-chat-application.md) | Retirement record for the former wallet frontend. |
| [`ackrate-sdk-npm.md`](ackrate-sdk-npm.md) | Package/version map, typed APIs, publication, and clean-install checks. |
| [`repo-inventory.md`](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/repo-inventory.md) | Current repository surfaces and ownership boundaries. |
| [`live-failure-drills.md`](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/live-failure-drills.md) | Fresh testnet revocation, downtime recovery, and expiry evidence. |

## Package and app READMEs

| Surface | README |
|---|---|
| Agent SDK | [`packages/sdk/README.md`](../packages/sdk/README.md) |
| Stellar bindings | [`packages/stellar/README.md`](../packages/stellar/README.md) |
| Express middleware | [`packages/express-middleware/README.md`](../packages/express-middleware/README.md) |
| AP2 validator | [`packages/ap2/README.md`](../packages/ap2/README.md) |
| CLI | [`packages/cli/README.md`](../packages/cli/README.md) |
| Consumer agent | [`apps/consumer-agent/README.md`](../apps/consumer-agent/README.md) |
| Fulfillment agent | [`apps/fulfillment-agent/README.md`](../apps/fulfillment-agent/README.md) |
| Wallet and consumer chat | [retirement record](wallet-chat-application.md) |

## Security

| Document | Scope |
|---|---|
| [`docs/security/threat-model.md`](security/threat-model.md) | Current bound-v2 release threat model and named production gates. |
| [`docs/security/data-flow.md`](security/data-flow.md) | Current first-delivery and exact-recovery sequences. |
| [`docs/security/README.md`](security/README.md) | Current evidence index and historical-scope labels. |

The dated 2026-06 security reports are historical snapshots with exact old
versions. They are retained for traceability and are not current release proof.

## Historical material

Internal work logs and superseded review records are archived outside this
public product repository. Current package manifests, contract release READMEs,
and the pinned release map are authoritative.
