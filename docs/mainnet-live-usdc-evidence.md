# Mainnet research-agent USDC evidence

Status: passing  
Executed: 2026-08-26 20:52 UTC

The reference CLI completed its deliberately bounded Mainnet flow against the
governed MandateRegistry. It registered a 0.03 USDC mandate, approved only the
registry as spender, executed three agent-signed 0.01 USDC payments, and
observed the contract reject purchase four with `BudgetExceeded`.

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

## Reviewer command

Run the published Ackrate CLI directly from npm:

```bash
npx --yes @ackrate/cli@0.1.10 demo research-agent \
  --network mainnet \
  --manifest ./mainnet-deployment.json \
  --user-signer <funded-user-identity> \
  --agent-signer <funded-agent-identity> \
  --merchant <merchant-G-address> \
  --price 0.01 \
  --budget 0.03 \
  --confirm-real-usdc
```

The command fails closed unless the complete deployment manifest, Public
Network identity, canonical Circle USDC mapping, funded distinct actors,
unpaused registry, real-value confirmation, and exact three-price budget are
all present.
