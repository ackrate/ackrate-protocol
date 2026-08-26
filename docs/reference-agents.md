# Reference consumer and fulfillment agents

The consumer uses `agent.fetch()` with `proofPolicy: "bound-v2-only"`, an atomic
purchase claim, a durable pre-broadcast receipt store, an immutable
application-outcome store, restart hydration, and explicit application
acknowledgment. The fulfillment agent uses `createBoundReappPaidJsonRoute` with an
exact public origin, independent Stellar verification, an agent-signed GET proof, and
one atomic claim/result `BoundRedemptionStore`.

## Evidence

```bash
npm ci
npm run agents:testnet
```

The run creates fresh testnet actors and a 3 XLM mandate, serves three paid resources,
proves the fourth contract rejection, retains exact settlement receipts, and rejects a
settled transaction re-signed for a new request with HTTP `409`.

## Mainnet USDC evidence

```bash
npx --yes reapp-protocol-cli@0.1.8 demo research-agent --network mainnet
```

The command opens the hosted Freighter-authorized pair. The consumer uses the
same `agent.fetch()` implementation, the fulfillment route advertises and
verifies 0.01 Circle USDC, and the verified
[`CDBTG5ZK…PAGS`](https://stellar.expert/explorer/public/contract/CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS)
mainnet MandateRegistry enforces the 0.03 USDC mandate. The browser surfaces the
resulting settlement transaction as a public Stellar Expert link.
