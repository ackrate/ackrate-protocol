# npm workflow validation — September 27, 2026

The candidate implementation at `eadb8f3cf87278c08fb41561e78da802c4f2a7d2`
was installed from packed npm artifacts in an isolated Node 22.23.3 consumer.
Core 0.4.2, AP2 0.4.1, Express middleware 0.3.1 and CLI 0.2.2 were local
candidate tarballs; Stellar 0.3.0 came from the public npm registry. These
results do not claim the candidates have been published.

## Executed workflows

| Workflow | Result |
|---|---|
| Core README registration, allowance, direct payment and revocation | Live Testnet pass; exact amount and contract sequence checked. |
| AP2 README signed admission, registration, payment and replay rejection | Live Testnet pass. |
| Stellar README network configuration and balance read | Live Testnet pass. |
| Installed CLI research-agent demo | Three paid HTTP deliveries, exactly 3 XLM received, fourth purchase rejected. |
| Installed CLI persistent project | Init, setup, mandate creation, payment, exact-hash reconciliation, acknowledgment and cleared lock passed. |
| Installed CLI ops create/verify/combine | Testnet-network offline envelopes; two distinct signatures and unchanged hash verified; duplicate signatures rejected. No governance transaction submitted. |
| Standalone SDK lifecycle | All 8 checks passed on Testnet. |
| Lower-level Stellar CLI lifecycle | All 9 on-chain checks passed with a protected named Testnet identity; no raw key passed in command arguments. |
| Independent mandate gate check | Live contract, token allowance and balance reads confirmed revoked status and zero spendable amount. |
| Reference consumer and merchant | Live 402 → registry payment → bound proof → delivered JSON; fourth purchase and retargeted replay rejected. |
| Recovery/failure drills | All 3 passed: revoke, merchant outage with receipt recovery and zero second payment, and expiry before payment. |
| Adversarial suite | All 6 scripts / 52 checks passed, including a transaction included in a ledger and reverted for stale sequence. |
| Standalone AP2 documentation example | Offline valid admission, overspend rejection and wrong-merchant rejection passed. |
| Packed SD-JWT helper | All 14 cryptographic tests passed against the installed subpath. |
| Canonical Stellar x402 | Real local HTTP facilitator used upstream 2.27.0 verification/settlement, a signed Testnet authorization and actual token transfer; decoded receipt, independent chain success and exact balance delta agreed. |

README snippets used funded disposable Testnet actors, durable storage fixtures,
explicit Testnet arguments and native Testnet XLM in place of Mainnet USDC.
The adaptation did not turn fixture responses into chain evidence. The source
reference-app files used installed candidate packages, not workspace package
links. Offline cryptographic and signing tests are labelled separately from
live settlement.

Representative Testnet payments:

- [Core README payment](https://stellar.expert/explorer/testnet/tx/74139fb950378cb5e57b6d95db6ce0d6470d5d56b8d0679604d8460c77744103).
- [AP2 admitted payment](https://stellar.expert/explorer/testnet/tx/79e6c067ba8aa37c0dd2aa5a16918400d78e22240a862ce6400cf5cf41c0df60).
- [Recovered delivery, no second payment](https://stellar.expert/explorer/testnet/tx/465267c8556142acf002730c70518a1900471da75bb1beac78e01fa86d9e02fc).
- [Canonical x402 transfer](https://stellar.expert/explorer/testnet/tx/662aa7bffa7de1fd6fd2f23f25b253333473c5a51a08dc208e9055643449ec96).

## One Mainnet workflow

Using the existing dedicated test wallet and protected staging relay signer,
the Core workflow registered a 0.01 USDC mandate, approved exactly that allowance,
paid once and revoked the mandate. The relay is both agent and merchant in this
existing topology. The separate CLI Mainnet demo requires three distinct actors.

- [Registration](https://stellar.expert/explorer/public/tx/b0e93b039a5ca071038a282ab327ab842befcd110e6be8017fd41c8e00c9a043).
- [Allowance](https://stellar.expert/explorer/public/tx/582388e6d099cbc993ed9b9db3df0ae3ac5f58e1c5028fe9ee18b1822bcf53b0).
- [Exactly 0.01 USDC payment](https://stellar.expert/explorer/public/tx/325eae651ed1a575f7d4ccb8de1f4249be7e30ba6dac40fd2a42d6ee8dcd69f5).
- [Revocation](https://stellar.expert/explorer/public/tx/2382fc2c8cc18df9b9b0a65fb98cf1ddc4504649c1d9e78820a5e4a4a353e1f0).

RPC confirmed the pinned registry WASM, schema 2, unpaused status, allowed Circle
USDC and account authorization before signing. Independent Horizon records
confirmed all four transactions and matching 0.0100000 USDC debit/credit effects.
The payer's USDC changed from 0.10 to 0.09. Final mandate status was `Revoked`,
spent was 0.01 and sequence was 1; an attempted post-revocation payment was
rejected before signing. Total charged transaction fees were 0.1365008 XLM.

The test harness initially refused registration before signing because its
fee ceiling was below the required resource fee. The run proceeded only after
confirming no transaction had been signed. A final assertion then used an
incorrect status field; this was corrected and verified read-only against the
already completed transactions. No payment was repeated.

## Remaining limits

The successful-register/failed-allowance **setup-registration resume is
Mainnet-only**. Its deterministic test suite covers success and fail-closed
checks, but it was not executed as a fresh live recovery here. It cannot be
claimed as Testnet E2E, and automatic interrupted-demo resume is not supported.

The canonical run used a real locally operated facilitator; it does not certify
an external provider or production deployment. The Mainnet proof is a direct SDK
payment, not hosted resource delivery or native wallet/device acceptance.
Contract deployment, upgrade, authority rotation and hosted application work
remain separate from npm package validation.

The executed package workflows passed with no runtime defect found. Unqualified
“every documented workflow passed live” would be inaccurate because of the
Mainnet-only setup-recovery limit above. Publishing also requires authorized npm
publisher access and registry integrity/install checks after publication.

The [machine-readable matrix](npm-workflow-evidence-2026-09-27.json) records
source, versions, proof boundaries and transaction references. Follow the
[Testnet guide](testnet-workflows.md) to reproduce the supported workflows and
the [release matrix](ackrate-sdk-npm.md) for publication status.
