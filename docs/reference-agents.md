# Reference consumer and fulfillment agents

The consumer uses `agent.fetch()` with `proofPolicy: "bound-v2-only"`, an atomic
purchase claim, a durable pre-broadcast receipt store, an immutable
application-outcome store, restart hydration, and explicit application
acknowledgment. The fulfillment agent uses `createBoundAckratePaidJsonRoute` with an
exact public origin, independent Stellar verification, an agent-signed GET proof, and
one atomic claim/result `BoundRedemptionStore`.

Both references accept an injected `NetworkConfig`. The consumer also accepts a
secret-free `StellarSigner`, and the fulfillment route accepts the manifest's
USDC SAC, `stellar-mainnet` label, and low-value price. No source edit or testnet
fallback is required when the completed mainnet deployment manifest arrives.

## Evidence

```bash
npm ci
npm run agents:testnet
```

The run creates fresh testnet actors and a 3 XLM mandate, serves three paid resources,
proves the fourth contract rejection, retains exact settlement receipts, and rejects a
settled transaction re-signed for a new request with HTTP `409`.

The CLI now runs these same reference agents on testnet or in explicitly confirmed
Mainnet mode. Mainnet is derived only from the verified deployment manifest, uses
chain-read USDC decimals, keeps user authorization in a named Stellar CLI identity,
and accepts the bound-proof agent key only through a named secret-manager environment
variable. Transaction receipts, delivered responses, contract state, merchant delta,
and the fourth no-payment budget rejection must all agree before success is reported.
