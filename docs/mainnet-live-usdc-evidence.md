# Historical Mainnet USDC evidence and current reference-agent acceptance

Status: historical direct-payment check passed

Executed: 2026-08-26 20:52 UTC

The reference CLI completed its deliberately bounded Mainnet flow against the
older governed MandateRegistry `CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS`.
It registered a 0.03 USDC mandate, approved only the
registry as spender, executed three agent-signed 0.01 USDC payments, and
observed the contract reject purchase four with `BudgetExceeded`.

This run used the CLI's direct `agent.pay` path available at that time. The later
reference-agent demo uses `buyResearch` and the fulfillment server to complete
HTTP 402 → `execute_payment` → bound proof → HTTP 200. The transactions below
prove the earlier real-USDC transfers and budget rejection; they are not live
delivery evidence for the later HTTP flow or the external Agent402 marketplace.

Recheck the old canary actors' current public 2-of-3 account policy and Circle
USDC trustline, plus the historical registry/token events, without signing or
submitting a transaction:

```bash
npm run verify:mainnet-evidence
```

This verifier is deliberately pinned to the old registry and its recorded
transactions. A passing result does not verify the official WR/V2 deployment,
the current published CLI, or reference-agent HTTP delivery. The original
receipts below retain their original identities.

## Exact actors and policy

| Role | Mainnet address |
|---|---|
| Mandate user | `GCFH7H3OTPKXLWZFDMPOGUVI4QRIYHX2G5EDRBGAXKTIARBYGDAW4IKN` |
| Consumer agent | `GBALWVF5IYJUW6NBQE7UIOM2JRZIFMMS7OXFDWSYRHU2GUPS3OUM5ZSZ` |
| Merchant / recipient | `GBE3PH4ZYVYUXZWZL4YJP22H5J46U6VQVF6SYNJ3GGU3RHBN4M77VNBG` |
| MandateRegistry | `CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS` |
| Circle USDC SAC | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Mandate ID | `6b19d87862412e475fccb91be905af4e62ad91cd7d590eefd05aa018af86f999` |
| Budget / price | 0.03 USDC / 0.01 USDC |

The three roles are distinct. The CLI used named external Stellar identities;
no secret or recovery material was accepted in command arguments, printed, or
committed.

## Ledger evidence

| Event | Transaction |
|---|---|
| Service wallet acquired 0.04 USDC for the bounded run | [`6d6b8200…b7d8`](https://stellar.expert/explorer/public/tx/6d6b82001252748b254065e206b5b0716da0dde9372d9269a758754cf997b7d8) |
| Register 0.03 USDC mandate | [`e7f7af3c…401e`](https://stellar.expert/explorer/public/tx/e7f7af3cd172718e2acc91319774b90a241a777cc8e324158aeaf6d43dcc401e) |
| Approve MandateRegistry for 0.03 USDC | [`66138fa8…c668`](https://stellar.expert/explorer/public/tx/66138fa85ca1f3e7283281af3efe4005b4839251ee88a94ae7b72dd666a0c668) |
| Payment 1: 0.01 USDC | [`934239bc…bf8a`](https://stellar.expert/explorer/public/tx/934239bcace9393e2ed0a39f114bf1d45c70e434ab4963a04ee17a132ea3bf8a) |
| Payment 2: 0.01 USDC | [`dc4ba3cc…c48b`](https://stellar.expert/explorer/public/tx/dc4ba3ccfe04ee6daabf70e0253226daae4e73ee686db965fe00634b4bdac48b) |
| Payment 3: 0.01 USDC | [`ba282c06…e90e`](https://stellar.expert/explorer/public/tx/ba282c06511815319fb204d5e49bbed1ce2e062791032935dbb1031b1c03e90e) |

After payment three, the contract state read `seq=3` and `spent=0.03 USDC`.
The recipient's Circle USDC balance increased by exactly 0.03 USDC. Purchase
four failed during contract simulation with `BudgetExceeded`, so it was not
broadcast and did not move value or charge a transaction fee.

## Published checkpoint and prepared patch — live acceptance pending

The September 7, 2026 publication checks verified `@ackrate/cli@0.2.0` with
Stellar `0.3.0`, Core `0.4.0`, AP2 `0.4.0`, and middleware `0.3.0`.
See the [dated public-install and integrity record](t3-step-1-gate-2026-09-07.md).
The supported package is the scoped `@ackrate/cli`, with executable `ackrate`.
The project owner approved the ACKRATE name and scoped command on September 7,
2026; the earlier CLI roadmap name is superseded.

Core `0.4.1` and CLI `0.2.1` are the prepared repair releases. They include
exact-receipt recovery fixes, invalid RPC-evidence retention, and an atomic
demo/payment journal claim that blocks replacement of an interrupted demo.
The command below pins the new CLI candidate, not the older published baseline.
Publication, public-archive verification, and release-specific live acceptance
must still be recorded; none is asserted by this preparation update. Do not
substitute a local bundle for proof that the public npm command works.

```bash
npx --yes @ackrate/cli@0.2.1 demo research-agent \
  --network mainnet \
  --user-signer <funded-user-identity> \
  --agent-signer <funded-agent-identity> \
  --agent-secret-env ACKRATE_AGENT_SECRET \
  --merchant <merchant-G-address> \
  --price 0.01 \
  --budget 0.03 \
  --confirm-real-usdc
```

This release defaults to Mainnet and bundles the official manifest for
[CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR](https://stellar.expert/explorer/public/contract/CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR).
No separate manifest download is required. An optional `--manifest` must match
that official deployment. A secret manager must inject the agent key matching
`--agent-signer` into `ACKRATE_AGENT_SECRET`; the flag accepts the variable name
only, never the key. The user's transaction signatures remain with the named
external Stellar identity.

Use Node.js 22 or newer and three distinct existing G accounts. For the example
above, the user needs at least 0.03 sendable canonical Circle USDC and the
merchant needs at least 0.03 authorized USDC receiving capacity. The user and
agent each need at least 0.50 spendable XLM above reserves, sponsorship
obligations, and selling liabilities. The command checks Public Network identity,
the USDC mapping and decimals, actor authorization/capacity, unpaused registry,
price/budget bounds, and explicit real-value confirmation before the run.
These unsigned snapshots do not reserve funds or guarantee later fees.

## Evidence required for a new Step 3 run

- Record the UTC timestamp, exact public package version and archive integrity,
  release source, confirmation that CLI `0.2.1` bundles the repaired Core `0.4.1`,
  full WR contract and USDC identities, public actors, selected
  price/budget, and registration-returned on-chain mandate ID.
- Retain registration and contract-only allowance transaction hashes, then three
  delivered source receipts and three distinct finalized payment hashes from
  the consumer → HTTP 402 → `execute_payment` → bound proof → HTTP 200 flow.
- Independently check each exact WR payment event and matching Circle USDC
  transfer, including mandate, agent, merchant, asset, amount, sequence, ledger,
  and transaction time. Transaction success alone does not establish delivery.
- Record final `seq=3`, `spent=0.03 USDC`, and merchant balance delta `+0.03 USDC`
  for the example. Capture purchase four's `BudgetExceeded`, no fourth payment,
  and no protected output. State whether rejection occurred during contract
  simulation or on a ledger; do not invent a hash for a non-broadcast rejection.
- Preserve sanitized command output and delivered results separately from
  protected local state. Do not publish secret keys, environment contents,
  signed transaction envelopes, or secret-bearing receipt files.
- After an interrupted run, preserve the original run marker, receipt, outcome,
  and delivery origin, then reconcile the exact payment before another spending
  action. The shared demo/payment claim blocks fresh-run replacement; generic
  payment acknowledgment cannot remove a demo marker. Reconciliation reports
  retained paths for manual exact-receipt recovery, not automatic demo resume.

The reference server serves deterministic research content. Its acceptance is
separate from the hosted wallet and external marketplace flow. This page asserts
no newer live run; current Mainnet reference-agent acceptance remains open until
the release-specific transaction and delivery evidence above is recorded.
