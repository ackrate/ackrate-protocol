# AP2 validation

The [AP2 package README](../packages/ap2/README.md) is the canonical signed-intent
example and API reference. It defines supported intent semantics, trusted input
requirements, replay admission and durable-store behavior. Its separate SD-JWT
entrypoint verifies cryptography; callers still enforce issuer trust, business
constraints and replay policy.

Validation itself is offline. Registering the admitted mandate, approving its
allowance and paying are separate on-chain operations; the contract enforces
every payment. Use the [Testnet guide](testnet-workflows.md#sdk-and-ap2-examples)
for explicit development-network configuration and the [release matrix](ackrate-sdk-npm.md)
for installable versions.

The package tests run with `npm run test -w @ackrate/ap2`. Live and packed-package
results are recorded in [September 27 workflow evidence](npm-workflow-evidence-2026-09-27.md).
