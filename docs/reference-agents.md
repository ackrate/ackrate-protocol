# Reference consumer and fulfillment agents

The consumer uses `agent.fetch()` with `proofPolicy: "bound-v2-only"`, a durable
pre-broadcast receipt store, an immutable outcome store and explicit delivery
acknowledgment. The fulfillment agent uses `createBoundAckratePaidJsonRoute`, an
exact public origin, independent chain verification and atomic claim/result
storage. Both accept an explicit network configuration.

- Run locally with the [Testnet reference workflow](testnet-workflows.md#local-express-and-reference-agents).
- Run the installed CLI with the [package instructions](../packages/cli/README.md#run-the-reference-research-agent).
- Understand the [HTTP challenge and settlement sequence](x402-roundtrip.md).
- Inspect [live recovery drills](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/live-failure-drills.md) and [current validation evidence](https://github.com/ackrate/ackrate-project/blob/main/instance/artifacts/108-other-repository-artifacts/ackrate-protocol/docs/npm-workflow-evidence-2026-09-27.md).

The Mainnet CLI demo requires three distinct accounts and detached agent signing
from its configured secret manager. The direct Core payment API also supports
the hosted relay topology in which the agent is the merchant. These are different
workflows; a direct transfer does not prove hosted resource delivery.
