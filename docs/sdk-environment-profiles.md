# SDK application environments

The SDK reference application offers navigation between separate deployments.
Each server runs one immutable profile; a browser request cannot select its RPC,
registry, settlement asset, signer, merchant, or database.

| SDK profile | Deployment audience | Stellar chain | Asset |
| --- | --- | --- | --- |
| Staging | Staging | Testnet | Test XLM |
| Mainnet | Production | Mainnet | Real USDC |

These names apply to `apps/wallet-chat`. The separate consumer application can
use Mainnet in its staging deployment; a staging hostname never proves Testnet.

## Configuration

Set `ACKRATE_APP_PROFILE` to `staging` or `mainnet`. The default is staging.
For compatibility, `ACKRATE_WALLET_NETWORK=mainnet` selects the mainnet profile
when no profile is given. If both values are present they must agree; invalid or
conflicting values fail closed. Configuration is deployment-owned, never a
query parameter, request body field, or browser preference.

Mainnet uses the SDK's bundled official `MAINNET` configuration. An optional
`ACKRATE_MAINNET_DEPLOYMENT_MANIFEST_JSON` must pass
`publishedMainnetNetworkFromDeploymentManifest`, including the published source,
artifact and deployment identity. Loading this public manifest neither activates
payments nor verifies current chain state. The explicit Mainnet enable value,
independent service configuration, durable database, exact source commit and
hosted origin remain required. Public identities and exact package installation
versions are recorded in [Mainnet configuration](mainnet-configuration.md).

Navigation is opt-in. Set these public variables only when the intended separate
deployment is available, using these exact allowlisted HTTPS origins:

| Variable | Approved destination |
| --- | --- |
| `ACKRATE_STAGING_APP_ORIGIN` | `https://ackrate-ackrate-protocol-staging-54c60f4b.vercel.app` |
| `ACKRATE_MAINNET_APP_ORIGIN` | `https://ackrate-ackrate-protocol-e56a218.vercel.app` |

Unset or invalid destinations render as **Not configured** without disabling the
current profile. Invalid values produce a fixed public diagnostic, never an
echo of the supplied value. Navigation uses a plain same-tab link: no wallet,
session, mandate or payment parameters are carried. Switching is paused during
a wallet action and does not revoke existing mandates. Each destination requires
its own sign-in and action approvals. A configured link is not a readiness claim.

## Isolation and recovery

Keep database, agent signer, merchant service and session credentials separate
for each deployment. Do not copy production services to staging. This change
does not activate deployment routing or satisfy isolated-service release gates.

Version 2 authentication tokens bind the wallet and Stellar network to a profile
fingerprint covering deployment identity, origin, registry, asset, release,
agent and merchant configuration, and catalog. A token from an older profile or
version is rejected, even if an operator accidentally reuses a session secret.
Host-only secure cookies and same-origin checks remain in place. Changing the
profile requires a fresh sign-in; merely changing source revision or destination
links does not invalidate it.

Saved browser mandates use the profile fingerprint and wallet in their key.
Legacy or other-profile entries are retained but never silently loaded into the
new profile. Existing on-chain mandates and allowances remain effective until
revoked; inspect earlier transaction evidence before setting a replacement cap.
There is no payment-journal migration or receipt deletion. Each deployment retains
its existing database and recovery records; do not repoint a running deployment
to a different network or share its database with another profile.

Server tools still derive the catalog, price, merchant, asset and network from
trusted configuration and compare them with current mandate state. The SDK
passes this network explicitly to `ackrate.agent`; no selector action signs,
submits or pays. Contract enforcement and exact-receipt delivery recovery remain
as documented in [the wallet flow](wallet-chat-application.md) and
[the bound payment round trip](x402-roundtrip.md).

## Verification

Run `npm run verify` before pushing. Configuration tests cover profile/network
conflicts, unconfigured and hostile destinations, official manifest identity,
and fingerprint separation. Authentication tests reject cross-profile,
cross-network and legacy tokens. Synthetic selector fixtures cover current,
available, unavailable and pending states without wallets or paid services.

The health endpoint reports configuration readiness and the public profile. Its
`durableState` value indicates that a database URL exists, not that a database
connection or current contract state has been verified. Live acceptance still
requires independent database/RPC checks, wallet signing, contract checks and
explicitly authorized payments for the selected environment.
