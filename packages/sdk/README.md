# @ackrate/core 0.4.0

Give an agent a capped USDC budget on Stellar Mainnet. The MandateRegistry
enforces the budget, merchant, agent, expiry, and payment sequence on-chain.
The SDK prepares the workflow; it never receives custody of the user's funds.

Mainnet MandateRegistry:
[`CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR`](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).

`ackrate.mainnet` uses this official deployment through `@ackrate/stellar`.
Core's default network is Mainnet. Authorized upgrades replace the contract
implementation at the same address; compatibility and deployment evidence
must still be checked when the implementation changes.

## Install

```bash
npm install --save-exact @ackrate/core@0.4.0 @stellar/stellar-sdk@16.3.0
```

Requires Node.js 22 or newer and the coordinated Stellar package `^0.3.0`.
See the [release status](https://github.com/ackrate/ackrate-protocol/blob/main/docs/ackrate-sdk-npm.md)
for publication and clean-install verification.

## Authorize a budget and pay

This example authorizes real USDC. Obtain the user's approval of the merchant,
`0.03` USDC cap, and one-hour expiry before running the signing steps. The
accounts must exist, be authorized for USDC, and have enough XLM for fees.

`userSigner` and `agentSigner` below are wallet or securely managed
`StellarSigner` integrations. `merchantAddress` is your verified seller address;
`saveMandate` and `paymentJournal.save` are durable application storage.

```ts
import { ackrate } from "@ackrate/core";

const mandate = ackrate.createIntentMandate({
  user: userSigner.publicKey,
  agent: agentSigner.publicKey,
  merchant: merchantAddress,
  asset: ackrate.mainnet.settlementAsset.contractId,
  maxAmount: "0.03",
  expiry: Math.floor(Date.now() / 1000) + 3600,
});

await ackrate.registerMandate(mandate, { signer: userSigner });
await saveMandate(mandate); // Retain the confirmed registry storage ID.
await ackrate.approveBudget(mandate, { signer: userSigner });

const agent = ackrate.agent({ mandate, signer: agentSigner });
const txHash = await agent.pay("0.01", {
  onPrepared: (pending) => paymentJournal.save(pending),
});

console.log(`https://stellar.expert/explorer/public/tx/${txHash}`);
```

The two user approvals do different jobs: registration stores the mandate;
allowance approval lets the **contract**, not the agent, transfer up to the
approved token allowance. The budget is a cap, not an upfront deposit. Each
payment still has to pass the contract's `execute_payment` checks.

Registration updates the mutable mandate's `id` and `idBuffer` to the confirmed
on-chain storage ID and retains its original digest as `credentialHash`. Await
registration and persist the updated mandate before constructing an agent.

## Buy an x402 resource

Use `proofPolicy: "bound-v2-only"` for new paid endpoints. The authenticated
challenge binds the exact HTTP origin, GET path and query, registry, network,
merchant, asset, amount, and validity window. The agent pays through
`execute_payment`, then signs a proof binding that challenge to the settlement.
The merchant independently verifies the payment before delivering its result.

```ts
import { getSettlementReceipt } from "@ackrate/core";

const consumer = ackrate.agent({
  mandate,
  signer: agentSigner, // Also supports detached signPayload for bound proofs.
  proofPolicy: "bound-v2-only",
  receiptStore,        // Durable SettlementReceiptStore implementation.
});

const response = await consumer.fetch("https://merchant.example/report");
const result = await response.json();
const receipt = getSettlementReceipt(response);
await persistAcceptedResult(result, receipt);
if (receipt) await consumer.acknowledgeDelivery(receipt);
```

Your `receiptStore` must durably implement `savePending`, `listPending`, and
`clearPending`. The exact signed transaction hash and bound proof are saved
**before** broadcast. Storage failure prevents submission. On restart, pending
receipts restore the no-second-payment lock. Multi-worker applications need
shared, linearizable storage and coordination; an in-memory store is not enough.

A non-402 response is returned without payment. Redirects are disabled so a
proof cannot be forwarded to a different origin. The HTTP adapter is separate
from the mandate and contract, allowing the wire format to evolve independently.

## Recover the original purchase

If payment or delivery becomes uncertain, do not start a fresh purchase. Recover
the saved receipt and retry its exact proof:

```ts
import { DeliveryPendingError } from "@ackrate/core";

try {
  const response = await consumer.fetch("https://merchant.example/report");
  const result = await response.json();
  const receipt = getSettlementReceipt(response);
  await persistAcceptedResult(result, receipt);
  if (receipt) await consumer.acknowledgeDelivery(receipt);
} catch (error) {
  if (!(error instanceof DeliveryPendingError)) throw error;
  const response = await consumer.retryDelivery(error.receipt);
  const result = await response.json();
  await persistAcceptedResult(result, error.receipt);
  await consumer.acknowledgeDelivery(error.receipt);
}
```

`retryDelivery` never makes another payment, signature, or transaction. It
validates the receipt and retries only its original request. New payments remain
blocked until the complete successful result is accepted by the application and
acknowledged. Protect receipts as sensitive bearer data for that exact request.

For direct `pay`, `SettlementUncertainError` carries the prepared hash and
validity window. Persist it and use `agent.reconcilePendingSettlement(record)`
to query the same transaction. A new payment is unsafe while its result is unknown.

## API reference

| API | Purpose |
|---|---|
| `ackrate.mainnet` | Official Mainnet configuration and canonical USDC asset. |
| `ackrate.createIntentMandate(input, network?)` | Create a local mandate and credential hash without signing or sending. |
| `ackrate.registerMandate(mandate, { signer }, network?)` | User-signed registration; return a transaction hash and retain the confirmed storage ID. |
| `ackrate.approveBudget(mandate, { signer }, network?)` | User-signed token allowance to the registry, capped at the mandate budget. |
| `ackrate.agent(options, network?)` | Create the agent using the registered mandate and authorized signer. |
| `agent.pay(amount, lifecycle)` | Agent-signed atomic mandate consumption and payment. |
| `agent.fetch(url, init?)` | Request a paid resource using the x402 challenge/payment/proof flow. |
| `agent.retryDelivery(receipt, init?)` | Recover the original delivery without paying again. |
| `agent.acknowledgeDelivery(receipt)` | Clear pending delivery only after durable application acceptance. |
| `agent.getPendingSettlement()` | Inspect the currently unresolved prepared payment. |
| `agent.reconcilePendingSettlement(record?)` | Query the original hash and return `pending`, `failed`, `expired`, or `succeeded`. |
| `getSettlementReceipt(response)` | Read the exact recovery receipt on a paid response. |
| `ackrate.revokeMandate(mandate, { signer }, network?)` | User-signed revocation; later payments are rejected on-chain. |
| `toStroops(amount, decimals?)` | Strict decimal-string to integer conversion. |

Mandate inputs:

| Field | Meaning |
|---|---|
| `user` | Public address that owns the funds and authorizes setup. |
| `agent` | Public address allowed to request payments. |
| `merchant` | Single permitted payee. |
| `asset` | USDC token contract from `ackrate.mainnet.settlementAsset.contractId`. |
| `maxAmount` | Total budget as a decimal string, such as `"0.03"`. |
| `expiry` | Expiry in Unix seconds. |
| `decimals` | Optional token precision; Stellar USDC uses `7`. |
| `nonce` | Optional binding nonce; omitted for normal unique mandates. |

Direct payments require a `PaymentSubmissionLifecycle` with durable
`onPrepared`. For a retriable application operation, also preserve its immutable
`expectedSeq`; both SDK and contract reject reuse of a consumed sequence.
Signers may be an external `StellarSigner` or a securely managed Stellar keypair.
Do not put secret material in code, URLs, logs, or command arguments.

## What the contract rejects

Unauthorized agents, wrong merchant scope, revoked or expired mandates,
overspending, non-positive amounts, replayed sequences, disallowed assets, and
payments while paused are rejected on-chain. A failed atomic payment does not
partially consume its budget or transfer tokens. A read-only validation or a
cached mandate is never a substitute for `execute_payment`.

Use decimal strings, not JavaScript floats, for money. The SDK rejects negatives,
scientific notation, excess precision, and malformed amounts. Inspect typed
errors and recorded transaction evidence; never convert uncertainty into an
automatic second payment.

## Related packages

- [`@ackrate/stellar`](https://www.npmjs.com/package/@ackrate/stellar): Mainnet configuration, wallet signing, and contract access.
- [`@ackrate/ap2`](https://www.npmjs.com/package/@ackrate/ap2): signed intent admission and binding.
- [`@ackrate/express-middleware`](https://www.npmjs.com/package/@ackrate/express-middleware): merchant-side verification and durable delivery.
- [`@ackrate/cli`](https://www.npmjs.com/package/@ackrate/cli): the same Mainnet workflow from a terminal.

The [configuration source](https://github.com/ackrate/ackrate-protocol/blob/main/packages/stellar/src/deployments.ts)
and [Mainnet deployment record](https://github.com/ackrate/ackrate-protocol-contracts/blob/main/contracts/mainnet-v2/README.md)
show how the coordinated packages map to the contract above.

Apache-2.0.
