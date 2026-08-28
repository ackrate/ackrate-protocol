# Ackrate wallet and consumer chat

Next.js application for the complete user-facing Ackrate flow:

1. connect a Stellar G-account without creating, signing, or broadcasting a
   transaction;
2. explicitly verify wallet control with a non-broadcast LOBSTR-signed
   challenge before enabling protected actions;
3. define and register an IntentMandate on Soroban;
4. approve a SEP-41 allowance to MandateRegistry;
5. ask the AI consumer agent to obtain an allowlisted paid source; and
6. inspect the registry, registration, allowance, payment, and revocation
   evidence on Stellar Expert.

The interface, model, SDK, caches, and server preflight checks are not payment
authorities. Every payment goes through `MandateRegistry.execute_payment`,
which atomically authenticates the agent, re-checks current mandate state,
consumes the exact sequence and budget, and transfers to the stored merchant.

## Local run

From the repository root:

```bash
cp apps/wallet-chat/.env.example apps/wallet-chat/.env.local
npm run build
npm run dev
```

Open `http://localhost:3000`.

Without complete environment values, the visual application and diagnostics
route load in configuration-required mode, but signing and payment controls
remain disabled. The application never substitutes placeholder identities or a
testnet contract for missing mainnet evidence.

## LOBSTR boundary

This release supports LOBSTR G-account full-transaction signing. It does not
claim LOBSTR authorization-entry signing or contract-account support. LOBSTR
signs the authentication, mandate registration, allowance, and revocation
transactions without exposing secret material to the application.

Initial wallet connection reads only the public G-address and creates no
transaction. Wallet verification is a separate, explicit action. Its challenge
contains one `manageData` operation, is never broadcast, is bound to a
short-lived signed challenge, and is accepted once.
Hosted mainnet operation requires the shared durable store so replay protection
survives serverless instances.

## Server payment boundary

The chat route controls the tool schema, catalog, merchant origin, price,
asset, agent identity, and MandateRegistry configuration. The model may select
only a source ID from the server allowlist. It cannot supply a URL, merchant,
amount, asset, contract, signer, or network.

Before improving the user experience, the server reads current contract state.
That read is not authorization. `agent.fetch()` still pays exclusively through
the contract's atomic `execute_payment` path using bound-v2 x402 proof policy.

Payment tool calls are reserved idempotently. A settlement receipt is durable
before broadcast and is cleared only after the delivered result is persisted.
If settlement or delivery is uncertain, the exact receipt is retained and the
application refuses to issue a second payment.

## Mainnet activation

There is no built-in mainnet contract ID. Mainnet configuration is constructed
only from the completed deployment manifest and fails closed unless all of the
following are present:

- exact activation confirmation;
- canonical clean contracts source commit;
- matching local and observed WASM hashes;
- verified governance and timelock roles;
- independently verified official Circle Stellar USDC issuer and SAC;
- deployment transaction evidence and independent verification timestamps;
- matching agent signer and public identity;
- fixed HTTPS fulfillment origin and server allowlist;
- strong session secret, OpenAI key, and durable database; and
- exact application source commit.

`/diagnostics` exposes only safe public fingerprints and blockers. It never
returns signer material, provider keys, database credentials, or session
secrets.

## Required environment

See `.env.example`. Secret values belong only in the hosting provider's secret
store. Never commit `.env.local`, Stellar secret keys, API keys, session
secrets, database credentials, or x402 settlement proofs.

## Verification

```bash
npm run typecheck -w @ackrate/wallet-chat
npm test -w @ackrate/wallet-chat
npm run build -w @ackrate/wallet-chat
npm run verify
```

The repository-wide verification includes the high/critical dependency advisory
scan. A successful web build does not by itself establish mainnet readiness.
