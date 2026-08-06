# Wallet and consumer chat application

`apps/wallet-chat` is the hosted Next.js reference flow for LOBSTR mandate
signing and contract-enforced agent payments. It uses Vercel AI SDK for model
streaming and tool execution and assistant-ui for the accessible chat runtime.

## Authority flow

```mermaid
sequenceDiagram
    participant U as User
    participant L as LOBSTR
    participant W as Wallet application
    participant R as MandateRegistry
    participant A as Consumer agent
    participant M as Fulfillment agent

    U->>L: Sign non-broadcast session transaction
    W->>W: Verify signature and consume one-time challenge
    U->>L: Sign register_mandate transaction
    L->>R: Register scoped mandate
    U->>L: Sign SEP-41 allowance transaction
    L->>R: Approve registry as spender
    U->>A: Request allowlisted source in chat
    A->>M: Request exact resource
    M-->>A: Bound x402 challenge
    A->>R: execute_payment
    R->>R: Authenticate, validate, consume, transfer atomically
    A->>M: Retry exact request with bound payment proof
    M-->>A: Verified resource
    A-->>U: Result and Stellar Expert transaction link
```

The preliminary contract read improves error messages but grants no authority.
The sole payment path remains the atomic contract invocation.

## Wire-format isolation

x402 parsing, challenge binding, and proof encoding remain in the SDK adapter.
The wallet application consumes `agent.fetch()` and does not duplicate that
wire format. A future x402 request or response shape can be implemented in the
adapter without changing IntentMandate fields or MandateRegistry storage and
execution semantics.

## Safe reference pattern

- sign registration and allowance in the user's wallet;
- approve the contract, never the agent or application;
- bind server tools to a fixed catalog and merchant origin;
- read current chain state only for fail-fast feedback;
- move money only through `execute_payment`;
- save an exact settlement receipt before broadcast;
- persist the delivered result before acknowledging the receipt;
- expose chain evidence for every broadcast transaction; and
- revoke the mandate on-chain when the user ends authority.

Unsafe patterns include trusting a cached mandate, transferring directly from
the agent, approving the agent as token spender, letting the model choose an
arbitrary URL or amount, retrying an uncertain settlement as a new payment, or
hardcoding an unverified mainnet deployment.

## Release gate

Mainnet hosting is blocked until the deployment manifest passes the SDK parser,
the exact application source commit is pinned, durable state is configured,
and the full contract, package, reference-agent, failure-drill, dependency, and
hosted-flow evidence passes from a clean checkout.
