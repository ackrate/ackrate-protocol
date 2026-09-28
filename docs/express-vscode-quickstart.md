# Express development workflow

Use the [local Express workflow](testnet-workflows.md#local-express-and-reference-agents)
from a terminal or VS Code. The [middleware README](../packages/express-middleware/README.md)
owns the merchant code example, durable-store contract and facilitator setup;
the [Core README](../packages/sdk/README.md) owns payment and exact-receipt recovery.

The old hosted `/express` workbench is not required for npm validation. Its
generated client and deployment have an independent release lifecycle; do not
use historical hosted results as proof of the current npm candidates.
