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

Mainnet activation is intentionally not claimed before deployment. Friday's
gate is the same flow with the verified manifest, chain-read USDC decimals,
external user authorization, a secret-manager or detached-payload-capable agent
signer, and a bounded real-USDC canary. Transaction, mandate, merchant delta,
receipt, and fourth-purchase rejection must all agree before completion.
