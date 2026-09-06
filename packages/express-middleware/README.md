# @ackrate/express-middleware 0.3.0

Paid JSON routes for Express 4/5, settled in USDC on Stellar Mainnet.

The package authenticates an exact-origin GET challenge, verifies the on-chain
settlement independently, atomically claims fulfillment, stores the exact JSON
result before sending it, and replays those bytes on recovery. A settlement can
never re-run arbitrary fulfillment work.

## Mainnet contract

The merchant verifies payments against
[`CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR`](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR),
using the official `MAINNET` configuration from `@ackrate/stellar`.
This middleware never signs a consumer payment or receives the user's allowance.
The registry enforces the mandate; the merchant verifies the resulting settlement.
Authorized upgrades replace the registry implementation at the same contract
address. Re-check implementation compatibility and release evidence after upgrades.

## Installation

Version **0.3.0** requires
**Node.js 22+**, core **0.4.0**, Stellar binding **0.3.0**, and exact
`@stellar/stellar-sdk@16.3.0`.

Install with:

```bash
npm install --save-exact @ackrate/express-middleware@0.3.0 @ackrate/stellar@0.3.0 @stellar/stellar-sdk@16.3.0 express@5.2.1
```

See the [coordinated release status](https://github.com/ackrate/ackrate-protocol/blob/main/docs/ackrate-sdk-npm.md)
for publication and clean-install verification.

## Safe paid route

`redemptionStore` is your shared durable `BoundRedemptionStore` implementation.
`loadResearchOnce` represents application fulfillment. Configure a funded public
read-source address, your merchant address, HTTPS origin, and a private challenge
key through your deployment's secret manager.

```ts
import express from "express";
import { MAINNET } from "@ackrate/stellar";
import {
  createBoundAckratePaidJsonRoute,
} from "@ackrate/express-middleware";

const app = express();

const paidResearch = createBoundAckratePaidJsonRoute({
  networkConfig: MAINNET,
  network: "stellar-mainnet",
  asset: MAINNET.settlementAsset.contractId,
  decimals: MAINNET.settlementAsset.decimals,
  merchant: process.env.ACKRATE_MERCHANT_ADDRESS!,
  sourceAccount: process.env.ACKRATE_READ_SOURCE_ADDRESS!,
  audience: "https://api.example", // exact public origin; never Host-derived
  challengeSecret: process.env.ACKRATE_CHALLENGE_SECRET!, // at least 32 bytes
  amount: "0.01", // USDC; callers authorize their own mandate and budget.
  resource: (request) => request.originalUrl,
  redemptionStore,
}, async ({ request, payment }) => ({
  body: {
    ok: true,
    resource: request.params.id,
    data: await loadResearchOnce(request.params.id),
    settledTx: payment.txHash,
  },
}));

app.get("/source/:id", paidResearch);
app.listen(4021);
```

The fulfillment callback receives no Express `Response` and cannot stream. Its
JSON result is bounded, hashed, and committed to the same redemption store
before any bytes are written to the client.

## Bound-v2 authorization

Before fulfillment is claimed, the package requires:

1. `ACKRATE-PAYMENT-CAPABILITIES: ackrate-bound-v2`; older clients receive `426`
   before payment.
2. An HMAC-authenticated challenge binding the exact public origin, GET method,
   path and query, network identity, registry, merchant, asset, amount, decimals,
   random id, and first-redemption deadline.
3. A canonical proof whose Stellar Ed25519 signature binds that challenge,
   transaction hash, and mandate id to the chain-derived mandate agent.
4. The configured RPC's exact network passphrase and a successful fresh
   transaction.
5. One unambiguous payment event from the configured MandateRegistry.
6. Current mandate user, agent, merchant, and asset identities.
7. One matching same-transaction SEP-41 transfer from user to merchant.

A copied public transaction hash cannot unlock data. Relaying a genuine quote
through another origin fails before the client pays because the signed audience
must equal the requested URL origin.

## Atomic fulfillment state

`BoundRedemptionStore` owns settlement binding and immutable response bytes in
one linearizable state machine:

```text
missing -> executing -> completed(exact JSON bytes)
```

- First valid proof: chain verification, atomic claim, one callback execution.
- Same proof while executing: `503`; the callback is never started again.
- Same proof after completion: exact stored bytes are replayed; no verifier or
  callback runs.
- Same transaction with another proof: `409`.
- Store/RPC outage: `503`; no protected result is sent.
- Callback exception: one sanitized terminal JSON result is stored and replayed.
- Completion-store failure: no result bytes are sent and the claim remains
  executing; recovery cannot re-run it automatically. After confirming the
  execution owner is dead, trusted operator/outbox code calls
  `resolveBoundAckrateInterruptedDelivery` to store one terminal result.

The first-redemption deadline does not prevent later replay of an already
completed exact result. That replay is delivery recovery, not fresh payment
authorization.

## Store deployment boundary

`InMemoryBoundRedemptionStore` is only for one-process demos and tests.
`FileBoundRedemptionStore` in the reference fulfillment app is restart-safe for
one Node.js process; instances targeting the same normalized path share one
in-process queue and use fsynced atomic replacement. It is not multi-process or
multi-host storage.

A production deployment must implement `BoundRedemptionStore.lookup`, `claim`,
and `complete` in one shared durable linearizable database. Never add a lease
that silently turns an executing claim back into runnable work. Side effects
must be transactionally coordinated with the claim through a durable job/outbox.

## Response behavior

| Condition | Status |
|---|---:|
| Missing/wrong bound-v2 capability | `426` before payment |
| Method other than GET | `405` |
| Missing, malformed, expired-first-use, mismatched, or unverified proof | `402` |
| Same settlement with a different proof | `409` |
| Existing execution or infrastructure/store outage | `503`, retry exact proof |
| New completed fulfillment | stored 2xx JSON |
| Exact completed recovery | byte-identical stored 2xx JSON |

All responses are private/no-store. Proof and stored result material are
sensitive and must not be logged or exposed.

## Primary API

### `createBoundAckratePaidJsonRoute(options, fulfill)`

Required options:

| Option | Meaning |
|---|---|
| `merchant` | Stellar address that must receive the verified transfer. |
| `amount` | Decimal price or request-specific resolver. |
| `audience` | Exact configured public HTTP(S) origin or safe resolver. |
| `challengeSecret` | Stable private 32–4096 byte challenge key. |
| `redemptionStore` | Atomic claim/result store shared by all serving workers. |

Optional controls include `resource`, `asset`, `networkConfig`, `network`,
`decimals`, `sourceAccount`, verifier/polling/freshness/header limits,
`challengeTtlSeconds`, development-only HTTP RPC, and `maxResponseBytes`.

Runtime exports include `createBoundAckratePaidJsonRoute`,
`resolveBoundAckrateInterruptedDelivery`, `InMemoryBoundRedemptionStore`,
`createStellarPaymentVerifier`, strict event
selection helpers, and all TypeScript store/evidence/result types.

The low-level bound authorization middleware is intentionally not exported from the
package root; public paid endpoints use the result-storing route wrapper.

## Wire-format isolation

x402 and AP2 evolve outside the MandateRegistry. HTTP/profile adapters may
change without changing contract storage or weakening `execute_payment`.

## Configuration evidence

- [Canonical Mainnet configuration](https://github.com/ackrate/ackrate-protocol/blob/main/packages/stellar/src/deployments.ts).
- [Mainnet contract deployment, source, and original artifact](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md).
- [Consumer payment and recovery workflow](https://github.com/ackrate/ackrate-protocol/blob/main/packages/sdk/README.md).

Apache-2.0.
