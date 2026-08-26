# Mainnet MandateRegistry activation plan

Status: product planning and testnet prototyping only.

Nothing described here has been deployed to Stellar mainnet. There is no
mainnet MandateRegistry contract ID, approved USDC Stellar Asset Contract ID,
final custodian roster, activation date, or production finding to publish yet.
Those values enter generated configuration only after the exact candidate is
verified and the corresponding chain state exists.

This document is the working notebook for the first mainnet workstream. It
combines design exploration with a one-step-at-a-time execution plan. It does
not authorize deployment by itself.

## Outcome and definition of done

The outcome is one source-verifiable MandateRegistry on Stellar mainnet that:

- preserves Ackrate's contract-authoritative payment invariant;
- uses OpenZeppelin Stellar role-based access control;
- requires two of three independent custodians to authorize every upgrade and
  every change that can expand privileged authority;
- uses one canonical on-chain timelock with no parallel delayed-upgrade path;
- supports external, hardware-backed, and offline signing without collecting
  custodian secrets;
- accepts only the independently verified Stellar Asset Contract for Circle
  USDC at activation;
- publishes its observed contract identity through one generated release
  manifest consumed by SDK configuration;
- completes one tightly bounded, short-lived, real-USDC purchase through the
  full Ackrate flow; and
- leaves enough public evidence for an independent operator to reproduce the
  build, verify authority and configuration, and trace the canary payment.

Definition of done is binary. Every item below must be true:

1. The exact optimized WASM has a reproducible SHA-256 tied to one source
   commit and one reviewed interface.
2. The deployed executable, roles, threshold authority, canonical delay,
   allowed asset, storage version, and pause state match the signed candidate
   manifest.
3. No single custodian can upgrade, unpause, change asset policy, rotate the
   authority set, shorten the delay, or create an alternate privileged path.
4. Every A+B, A+C, and B+C signer pair can complete its intended authorized
   operation; every single signer and malformed combination fails.
5. A generated release manifest is the only source for the mainnet registry
   and asset mapping used by packages, CLI output, agents, and public docs.
6. A clean external install can import the typed packages, select mainnet
   explicitly, and read the deployed configuration without source changes.
7. One bounded real-USDC mandate is registered, funded, consumed atomically,
   fulfilled, and independently reconciled without a second payment.
8. All release stop conditions remain clear, exercised, and operable.

### Product requirement map

This map keeps the workstream tied to its product outcome instead of letting
the implementation drift into unrelated platform work.

| Product requirement | Where it is designed | Where it is proven |
|---|---|---|
| MandateRegistry on Stellar mainnet | Steps 1–10 | Read-only chain verification in Step 10 |
| OpenZeppelin Stellar access control | Proposed role model and Step 3 | Role graph, bootstrap removal, and privileged negative suite |
| 2-of-3 upgrade authorization | Authority comparison and Step 2 | A+B, A+C, B+C success; every invalid combination fails |
| Timelock on contract changes | Canonical timelock design and Step 4 | Operation lifecycle and complete negative matrix |
| Team signature coordination | Tooling design and Step 6 | External/offline signing rehearsal with deterministic assembly |
| Contract identity in SDK configuration | Generated mapping and Step 7 | Candidate manifest before activation; observed identity after Step 10 |
| Real USDC through the complete flow | USDC activation rules and Step 11 | Bounded canary, settlement proof, fulfillment, and exact recovery |
| x402 can evolve independently | Versioned adapters and stable `PaymentIntent` | Cross-version adapter fixtures and no wire fields in contract storage |
| Negative cases run continuously | Continuous gate-check suites | Money, privilege, SDK, and adapter suites on every candidate change |
| Threat model and diagrams lead implementation | Security inputs and Step 1 | Accepted trust boundaries and flows before contract changes |
| Custodian ownership and recovery are operational | Custody model and Step 6 | Rotation, loss, compromise, and signer-combination rehearsals |
| Spending limits remain protocol-enforced | Contract-authoritative invariant | Bypass attempts, cached-state conflicts, and overspend rejection |
| Reference agents teach the safe pattern | Stable intent and live-drill sections | Full testnet rehearsal with explicit unsafe-pattern rejection |
| Failure behavior is observed before real value | Required live testnet drills and Step 9 | Rogue-agent, downtime, expiry, revocation, RPC, and store evidence |

### Contract-authoritative invariant

Money moves only through `MandateRegistry.execute_payment` or another explicitly
reviewed MandateRegistry capture point that performs validation and consumption
atomically before the SEP-41 transfer. The user approves token allowance for the
MandateRegistry contract, never for the SDK, agent, model, cache, merchant
application, or coordination tool.

The contract must re-check the stored user, agent, merchant, asset, amount,
expiry, active state, cumulative budget, expected sequence, pause state, and
token result in the same transaction that moves value. An SDK preflight can
fail early for usability, but it is never spending authority.

## Architecture sketch

```text
Custodians A/B/C
    │  two matching signatures over one immutable request
    ▼
Selected 2-of-3 authority
    │  proposer authorization
    ▼
OpenZeppelin Stellar Timelock Controller
    │  one scheduled operation, one delay, exact operation ID
    ▼
MandateRegistry role-protected privileged entry point

Versioned x402 adapter
    │  untrusted wire request/response
    ▼
Stable PaymentIntent
    │  normalized, network- and deployment-bound input
    ▼
MandateRegistry.execute_payment
    │  atomic validate → consume → SEP-41 transfer
    ▼
Independent merchant settlement verification → durable fulfillment
```

The authority design protects privileged operations. It does not replace the
user's mandate, the user's token allowance, or the agent authorization required
for a payment.

## Brainstorm: two credible 2-of-3 authority designs

The project should not select an authority model from prose alone. Both designs
must be implemented as minimal testnet prototypes against the exact privileged
Soroban invocation shape, then compared at a recorded decision gate.

### Option A — native Stellar G-account threshold

A dedicated G-account has three signer keys, each with weight `1`, and the
relevant threshold set to `2`. The account address is assigned the proposer or
administrative role. Custodians co-sign the transaction envelope that invokes
the privileged contract function.

Potential advantages:

- authorization is enforced by Stellar's native signer-weight and threshold
  rules;
- the account model and transaction envelope are widely understood;
- fewer custom account contracts and policy instances are introduced;
- standard Ed25519 and offline envelope signing may simplify operations; and
- account signer state can be inspected independently from the application.

Questions and risks to prove:

- which threshold applies to the exact smart-contract transaction and every
  source-account arrangement;
- whether Soroban authorization entries introduce an additional signing layer
  that the coordinator must bind and preserve;
- how signer rotation changes high-threshold account configuration without
  creating an intermediate one-key state;
- how sequence-number contention, fee bumping, simulation changes, and stale
  envelopes affect an offline flow;
- whether supported hardware signers expose the complete invocation and
  authorization tree clearly enough for informed approval; and
- whether the account's master key is safely disabled without creating an
  unrecoverable setup error.

### Option B — OpenZeppelin smart account with simple-threshold policy

An OpenZeppelin Stellar smart account defines the three custodians as signers
and attaches a simple-threshold policy requiring two valid signatures for the
privileged authorization context. The smart-account address is assigned the
proposer or administrative role.

Potential advantages:

- authorization scope can be bound to specific contracts and privileged
  functions through context rules;
- the policy directly expresses equal-weight 2-of-3 authorization;
- signer and policy composition can support future hardware or external
  verifier integrations; and
- authorization behavior can be tested at the Soroban
  `CustomAccountInterface` boundary.

Questions and risks to prove:

- added contract, policy, storage, TTL, and dependency surface;
- safe synchronization of signer-set changes with the stored threshold;
- exact replay domain and authorization-entry behavior;
- compatibility of delegated G-account, external, hardware-backed, and offline
  signers;
- upgrade and recovery semantics for the smart account and its policies;
- cost and operational complexity of the additional contract calls; and
- the risk of an overly broad context rule authorizing an unintended function
  or target.

### Testnet prototype matrix and decision gate

Both prototypes receive the same fixtures and operations:

| Area | Evidence required from both prototypes |
|---|---|
| Valid pairs | A+B, A+C, and B+C each authorize the same privileged test invocation. |
| Invalid signers | A, B, C, unknown, removed, duplicate, and wrong-key combinations fail. |
| Exact scope | Changed target, function, arguments, network, sequence, time bounds, or authorization tree fails. |
| Replay | Reusing a signature, request, envelope, or completed authorization fails. |
| Rotation | Replace one custodian while continuously preserving two-key control. |
| Recovery | One unavailable key follows the written path; two unavailable keys have no bypass. |
| Tooling | Hardware or offline signers can inspect and sign the immutable payload. |
| Operations | Deterministic assembly, independent verification, and status reads are practical. |
| Cost | Simulation records resource use and fee behavior for each privileged path. |
| Dependencies | Exact package versions, source commits, storage, TTL, and maintenance surface are recorded. |

Decision criteria, in order:

1. exact on-chain enforcement with no one-key bypass;
2. narrow authorization scope for every privileged operation;
3. safe rotation and one-key-loss recovery;
4. hardware and offline signing support;
5. independently verifiable transaction construction;
6. dependency and storage risk;
7. operational clarity; and
8. measured resource cost.

The decision record must include raw test evidence and a rejected-option
analysis. If neither prototype passes, implementation stops. The project does
not weaken 2-of-3 to preserve a schedule.

## Proposed access-control model

OpenZeppelin Stellar access control supplies the role framework. The addresses
assigned to roles remain provisional until the authority prototype and
configuration rehearsal pass.

| Role | Proposed holder | Capability | Required authorization |
|---|---|---|---|
| Top admin | Timelock Controller contract | Administer role hierarchy and top-level privileged configuration. | A ready timelocked operation previously authorized by 2-of-3. |
| Proposer | Selected 2-of-3 authority | Schedule an exact timelock operation. | Any two custodians over one immutable request. |
| Canceller | Selected 2-of-3 authority | Cancel a pending operation before execution. | Any two custodians; no one-key cancellation denial-of-service. |
| Executor | Open after delay, if prototype evidence supports it | Execute only an already-ready exact operation. | Permissionless trigger; authorization comes from proposal approval and elapsed delay. |
| Pause | Custodians A, B, and C individually, proposed | Stop money-moving entry points quickly. | One custodian for pause only. |
| Unpause | Timelock-controlled role | Resume money movement after cause and state are verified. | 2-of-3 proposal plus elapsed delay. |
| Asset policy | Timelock-controlled role | Add, remove, or replace an allowed asset contract. | 2-of-3 proposal plus elapsed delay. |

### One-key pause tradeoff

Allowing any one custodian to pause minimizes loss during a suspected
compromise, token incident, or contract anomaly. The cost is availability: one
lost or malicious pause key can halt payments.

The proposed asymmetric rule is:

- any one of A, B, or C may pause;
- pause cannot upgrade, rotate roles, change assets, transfer value, or unpause;
- unpause requires the normal 2-of-3 plus timelock path;
- every pause emits a stable event and triggers the incident runbook; and
- repeated or unexplained pauses trigger custodian replacement review.

The testnet prototype must compare this against 2-of-3 pause. The default
recommendation remains one-key pause because it can only reduce active money
movement, while restoration and authority changes stay slow.

### Permissionless execution after delay

The preferred executor configuration is open execution after the operation is
ready. This removes a final liveness dependency on a special executor key.
Anyone may trigger execution, but cannot change the target, function,
arguments, predecessor, salt, or ready time. The testnet prototype must prove
that open execution cannot substitute a different payload or execute an
unscheduled operation. If the OpenZeppelin configuration cannot express this
safely, use a narrowly held executor role and document the liveness tradeoff.

## One canonical timelock

The production candidate uses the OpenZeppelin Stellar Timelock Controller as
the only delay authority.

The current inline `schedule_upgrade` / `cancel_upgrade` / `execute_upgrade`
delay must not remain as a parallel production authority. The candidate design
must either remove that flow or make it permanently incapable of changing
WASM. The actual upgrade entry point is role-protected so only the Timelock
Controller can reach it. Role changes, signer-policy changes, asset-policy
changes, unpause, and delay changes must also pass through the same controller
when they can expand authority or resume money movement.

If the selected authority cannot safely propose to this controller, activation
stops. The response is not to retain the inline delay as a fallback.

### Operation identity and signed domain

The canonical on-chain operation ID follows the Timelock Controller's operation
hash over:

- target contract;
- function;
- typed arguments;
- predecessor; and
- salt.

For an upgrade, the new WASM SHA-256 is an exact typed argument and is therefore
bound into the operation ID. The coordinator's immutable request hash adds the
network passphrase, source account, sequence, fee bounds, ledger/time bounds,
simulation output, complete Soroban authorization tree, candidate source
fingerprint, and expected earliest execution ledger. This distinction matters:
the on-chain ID follows the controller implementation; the signing request
adds the network and transaction domain that custodians must verify.

### Timelock negative cases

Continuous tests must reject:

- execution before the minimum delay;
- execution of an unscheduled or cancelled operation;
- a second execution of a completed operation;
- changed target, function, arguments, WASM hash, predecessor, or salt;
- changed network passphrase, source, sequence, fee bounds, ledger bounds,
  simulation result, or authorization tree;
- a proposal from one signer, an unknown signer, a removed signer, duplicate
  signatures, or signatures over different request hashes;
- an alternate upgrade entry point or former administrator;
- changing the minimum delay outside a ready timelocked operation;
- role assignment or revocation outside a ready timelocked operation;
- unpause or asset-policy expansion outside a ready timelocked operation;
- pause authority attempting an upgrade or role change;
- bootstrap authority remaining after setup;
- incompatible or non-reproducible WASM;
- storage migration without the exact reviewed migration path; and
- replay across testnet and mainnet.

## Custody model and recovery rules

Public documentation uses role labels only:

- **Custodian A** — primary operations signer;
- **Custodian B** — independent technical signer;
- **Custodian C** — independent recovery signer.

Names, devices, storage locations, contact details, and escalation routes live
only in a private custodian register. No public file invents or exposes them.
No person, device, cloud account, password manager, or automation service may
control two custodian keys.

### Rotation

1. Open a rotation request identifying only the outgoing and incoming public
   keys, reason category, authority model, network, and affected context.
2. Verify the new key out of band and prove it can sign a harmless testnet
   request.
3. Prepare one atomic or safely ordered change that never drops below two usable
   custodians.
4. Obtain two current-custodian signatures over the exact change.
5. Schedule through the canonical timelock.
6. During the delay, independently verify the pending operation and new key.
7. Execute, read state from chain, and prove all three valid pairs under the new
   set.
8. Retire the old key according to the private handling procedure.

### One lost key

The remaining two custodians retain authority. They pause if loss could be a
compromise, rotate the missing key through the canonical flow, and verify the
new signer set before unpausing. No recovery secret or administrator bypass is
introduced.

### One compromised key

Any uncompromised custodian may pause. The other two verify the incident,
cancel unsafe pending operations, rotate the compromised signer through the
canonical flow, and re-run signer-combination tests before unpause.

### Two-key loss

There is deliberately no backdoor. If fewer than two authorized custodians
remain and the authority design offers no previously approved recovery
mechanism, privileged control is unavailable. The team follows the documented
containment and migration path rather than inventing a one-key override.
Mandate revocation and user-controlled allowance removal must remain available
where the contract and token design permit them.

## Signature-coordination tooling

The coordinator is a deterministic assembler and verifier, not a signer or
secret store. Proposed commands are product design, not currently shipped
behavior:

```bash
@ackrate/cli ops prepare --manifest candidate.json --out request.json
@ackrate/cli ops inspect --request request.json
@ackrate/cli ops sign --request request.json --signer external --out A.sig.json
@ackrate/cli ops verify-signature --request request.json --signature A.sig.json
@ackrate/cli ops assemble --request request.json --signature A.sig.json --signature B.sig.json --out envelope.xdr
@ackrate/cli ops verify-envelope --request request.json --envelope envelope.xdr
@ackrate/cli ops submit --request request.json --envelope envelope.xdr
@ackrate/cli ops status --operation-id <operation-id> --network mainnet
```

`prepare` writes an immutable request. `inspect`, `verify-signature`, and
`verify-envelope` are read-only. `sign` delegates to an external signer.
`submit` refuses an envelope that does not reproduce the request hash and the
expected ready operation.

### Immutable request fields

At minimum, the request binds:

- schema version and tool version;
- network passphrase and RPC identity;
- source account, sequence, fee bounds, time bounds, and ledger bounds;
- target contract, function, typed arguments, and complete sub-invocation tree;
- Soroban authorization entries;
- simulation ledger, transaction data, resource fee, and footprint;
- timelock operation ID, predecessor, salt, minimum delay, and earliest
  execution ledger;
- candidate WASM SHA-256 and source commit;
- current and expected role, asset-policy, pause, and storage-version state;
- human-readable effect summary generated from the typed payload;
- request creation nonce; and
- SHA-256 of the canonical serialized request.

Any changed field produces a different request hash. Signatures from different
requests are never combined.

### Signer boundary

- Hardware devices, offline machines, and external signing services receive
  only the immutable request or its exact signable representation.
- Custodians verify the network, target, effect, WASM, roles, delay, asset, and
  request hash on an independent display.
- The coordinator accepts signatures and public keys only.
- Seed phrases and private keys never enter repository files, environment
  files, command arguments, logs, CI, telemetry, or the coordinator process.
- Offline transfer uses a checksum-protected request file; returned signature
  files contain no secret material.
- The coordinator rejects unnecessary extra signatures and duplicate signer
  identities.

## x402 isolation and stable payment intent

Wire-format evolution remains outside MandateRegistry storage and methods:

```text
x402-vN request
  → versioned adapter parses and authenticates wire data
  → stable PaymentIntent
  → SDK prepares exact MandateRegistry call
  → contract validates stored mandate and consumes atomically
  → merchant independently verifies settlement
```

The stable `PaymentIntent` should contain only protocol-relevant normalized
fields:

- network identity;
- registry identity;
- mandate ID;
- expected agent;
- expected merchant;
- asset contract;
- amount in atomic units;
- expected sequence;
- mandate expiry; and
- delivery-binding digest.

HTTP header names, status-code variants, x402 version labels, transport
signatures, challenge encoding, and response envelopes do not enter contract
storage. A new wire version adds an adapter and fixtures; it does not redesign
MandateRegistry.

The SDK, adapter, quote cache, mandate cache, RPC cache, and merchant database
remain untrusted. The contract re-reads authoritative mandate state at consume
time. The merchant separately proves transaction success, registry event,
matching token transfer, identities, amount, network, and exact request
binding before durable fulfillment.

## USDC identity and activation rule

Circle's official Stellar mainnet asset identity is:

- asset code: `USDC`;
- issuer:
  `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.

This classic asset identity is known now. Its mainnet Stellar Asset Contract
ID is intentionally not written here.

At activation:

1. Reverify the code and issuer against Circle's current official address page.
2. Use the pinned official Stellar CLI on the mainnet network to derive the
   reserved asset-contract ID from
   `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.
3. Derive it independently with a second implementation or machine.
4. Read chain state to determine whether the built-in asset contract is
   deployed and verify its token interface, code, issuer relationship, symbol,
   and decimals.
5. Record commands, tool versions, network passphrase, RPC identity, ledger,
   outputs, and independent comparison.
6. Only then place the observed asset-contract ID in the signed candidate
   manifest.

The same rule applies to the MandateRegistry ID: it is recorded only after the
deployment transaction succeeds and independent read-only verification matches
the signed candidate. No placeholder resembling a real ID is permitted.

## Security inputs before implementation

Threat modeling and data-flow work start the implementation, not close it.
Before contract changes begin, freeze:

- assets, actors, trust boundaries, authoritative sources, and assumed
  capabilities;
- mandate registration, allowance, payment, revocation, expiry, and exact
  delivery-recovery flows;
- proposer, cancellation, execution, pause, unpause, rotation, delay change,
  upgrade, and migration flows;
- G-account and smart-account authorization-entry flows;
- USDC identity derivation and asset-policy activation;
- package-to-source-to-deployment mapping;
- RPC, storage, signing device, operator, dependency, and build boundaries; and
- failure ownership: who detects, who pauses, who verifies, who communicates,
  and who may resume.

Every threat receives a prevention or detection control, a test or drill, an
evidence location, and a release-blocking classification. Unknown or disputed
trust boundaries stop implementation until resolved.

## Continuous gate-check suites

These suites run from the first implementation commit and remain required:

### Money path

- unauthorized agent, wrong user, merchant, asset, amount, mandate, and network;
- zero, malformed, overflow-boundary, cumulative overspend, and token-decimal
  mismatch;
- expired, revoked, exhausted, paused, wrong-sequence, replayed, and re-entered
  payment;
- token allowance missing, expired, too small, or assigned to the wrong spender;
- token transfer failure after state preparation, proving atomic rollback;
- TTL boundaries before, at, and after mandate expiry;
- direct SDK or adapter attempt to bypass `execute_payment`; and
- exact recovery after settlement without a second payment.

### Privileged path

- all valid signer pairs and all invalid signer combinations;
- changed request field, wrong network, stale sequence, expired envelope, and
  changed simulation;
- unauthorized role use and role escalation;
- early, cancelled, duplicate, changed, and unscheduled timelock execution;
- pause-only signer attempting unpause, upgrade, role, delay, or asset changes;
- alternate or legacy upgrade path;
- bootstrap authority persistence;
- signer rotation intermediate states;
- one-key loss, compromise, and two-key-loss behavior;
- incompatible storage migration and changed WASM; and
- permissionless executor attempting any payload except the ready operation.

### SDK and adapters

- clean typed imports and explicit mainnet selection;
- unknown, stale, testnet, or conflicting deployment mapping;
- generated configuration drift across SDK, CLI, agents, and docs;
- each supported x402 adapter mapping to the same stable intent;
- malformed or future wire shapes failing closed;
- cached mandate or quote contradicting on-chain state;
- RPC disagreement, timeout, and stale ledger;
- settlement proof bound to the wrong request or requester;
- store outage and multi-instance redemption races; and
- package version, profile version, contract release, and deployment identity
  remaining distinct.

## Required live testnet drills

Each drill uses the exact candidate code and coordination flow. Evidence records
commands, commits, configuration fingerprints, transaction hashes, observed
state, and user recovery behavior.

1. **Rogue within budget, then overspend:** the agent completes repeated valid
   purchases up to the limit; the next purchase fails on-chain with no transfer.
2. **Merchant down before settlement:** the client receives no acceptable quote
   or cannot prepare durable state, so no payment is broadcast.
3. **Merchant down after settlement:** the exact persisted proof recovers the
   immutable result; balance and transaction evidence prove zero second payment.
4. **Expiry before quote:** the adapter and contract reject without payment.
5. **Expiry between quote and settlement:** the contract rejects atomically even
   if the quote was valid when issued.
6. **Revocation during activity:** a previously usable mandate is revoked; the
   next payment fails from authoritative chain state.
7. **Signer combinations:** A+B, A+C, and B+C succeed; A, B, C, unknown,
   duplicate, removed, and mixed-request signatures fail.
8. **Timelock lifecycle:** schedule, inspect, cancel, reschedule, wait, execute,
   and reject early, changed, and repeated execution.
9. **RPC outage or disagreement:** no uncertain state is treated as authority;
   the operator reconciles by exact hash before retrying.
10. **Store outage:** challenge, receipt, redemption, and fulfillment stores fail
    closed at their respective boundaries.
11. **Process recovery:** consumer and merchant restart at every pre- and
    post-settlement boundary without duplicate payment or duplicate fulfillment.

## Eleven-step execution plan

Only one step is active at a time. The next step starts when the current
step's evidence and exit condition are reviewed. A failed exit condition stops
the sequence; it does not become deferred cleanup.

### Step 1 — Freeze invariant, threat model, and diagrams

Produce the contract invariant, trust-boundary table, threat register, and data
flows for money, privilege, signing, activation, and recovery.

Exit: every actor, authoritative source, untrusted input, state transition, and
failure owner is explicit.

### Step 2 — Prototype both 2-of-3 designs

Implement the native G-account and OpenZeppelin smart-account alternatives on
testnet. Run the shared prototype matrix and record cost, complexity, signing,
rotation, and failure evidence.

Exit: one design is selected in a decision record, or work stops because neither
passes.

### Step 3 — Implement access control

Integrate OpenZeppelin Stellar access control with top admin, proposer,
canceller, executor, pause, unpause, and asset-policy roles. Prove the role
graph and bootstrap transition.

Exit: every privileged function has one intended role path and no former
administrator remains.

### Step 4 — Install the canonical timelock

Use the OpenZeppelin Timelock Controller as the sole delay authority. Remove or
permanently close the current inline delayed-upgrade authority. Bind the upgrade
WASM and every privileged change into exact operations.

Exit: the complete timelock negative suite passes and no parallel upgrade path
exists.

### Step 5 — Add USDC policy and TTL rules

Implement allowlisted asset policy, storage-version markers, mandate-aligned
allowance expiry, and instance/persistent TTL behavior. Use injected test
identities until activation.

Exit: asset mismatch, decimals conflict, expiry, TTL, migration, token failure,
and re-entry suites pass.

### Step 6 — Build coordination tooling and runbooks

Implement immutable request preparation, external signing, signature
verification, deterministic assembly, read-only inspection, submission, and
status commands. Write setup, rotation, loss, compromise, pause, cancellation,
upgrade, and recovery procedures.

Exit: two independent custodians can complete every intended operation on
testnet without sharing secrets.

### Step 7 — Generate SDK configuration and version mapping

Create one machine-readable candidate manifest and generate the SDK deployment
entry, CLI output, agent configuration, and public tables from it. Keep mainnet
inactive while contract and asset IDs are absent.

Exit: clean installs and CI prove every generated consumer agrees, while missing
or conflicting mainnet identities fail closed.

### Step 8 — Produce exact-candidate security evidence

Run the continuous money, privileged, SDK, adapter, dependency, secret, and
reproducibility checks against one candidate commit and optimized WASM.
Resolve every release-blocking finding with a regression test.

Exit: one fingerprinted candidate has no unresolved critical or high-severity
finding and every public function is in the coverage matrix.

### Step 9 — Rehearse the full testnet release

Execute all live drills with the selected authority, canonical timelock,
coordination tooling, generated configuration, reference agents, and recovery
stores.

Exit: the full flow and every required failure mode are reproduced from a clean
checkout with machine-readable evidence.

### Step 10 — Deploy and perform read-only mainnet verification

Reverify Circle USDC, derive and verify its Stellar Asset Contract, sign the
exact deployment request, broadcast through the approved process, and read all
critical contract state from independent endpoints. Do not fund a payment
mandate yet.

Exit: executable hash, interface, roles, authority, delay, pause state, allowed
asset, storage version, network, and empty initial state match the signed
manifest exactly.

### Step 11 — Run the bounded real-USDC canary

Fund only the approved low-value amount. Register one short-lived mandate,
approve only its bounded allowance, purchase through the versioned adapter and
MandateRegistry, verify settlement independently, persist fulfillment, exercise
exact recovery, and revoke or expire the mandate.

Exit: transaction, events, balances, mandate state, receipt, delivery, and
generated configuration agree, and evidence proves no path exceeded the exact
budget or paid twice.

## First working session agenda

The first session produces decisions and test fixtures, not deployed code.

1. Read the invariant aloud and reject any architecture that creates a second
   money path.
2. Draw the current inline-upgrade flow and proposed Timelock Controller flow;
   identify every authority that must disappear.
3. Enumerate every privileged function and assign its proposed role.
4. Define the exact G-account and smart-account prototype fixtures.
5. Define Custodian A/B/C public responsibilities and the private register
   fields without naming people publicly.
6. Freeze the canonical request schema and human-readable effect summary.
7. Write the first signer-combination, replay, changed-payload, early-execution,
   pause, and rotation tests before implementation.
8. Draw the x402 adapter, stable `PaymentIntent`, contract, verification, and
   recovery data flow.
9. Record USDC activation commands as templates with no mainnet IDs filled in.
10. Assign an owner and an independent verifier for Step 1 evidence.

Session output:

- accepted invariant;
- draft role graph;
- prototype fixture specification;
- canonical request schema;
- initial threat and data-flow set;
- open-decision register; and
- exact Step 1 evidence checklist.

## Open decisions

These decisions remain open until their stated evidence exists:

- native G-account threshold or OpenZeppelin smart-account threshold;
- one-key pause or 2-of-3 pause;
- permissionless executor after delay or narrowly held executor;
- exact timelock minimum delay;
- cancellation authority and incident escalation thresholds;
- smart-account and policy upgrade/TTL strategy, if that option is selected;
- exact hardware and offline signer integrations;
- rotation transaction ordering;
- RPC providers and independent verification endpoints;
- candidate storage migration strategy;
- canary amount, maximum fee, mandate lifetime, and observation window;
- merchant and fulfillment target for the canary; and
- criteria for any later non-upgradeable contract.

Each decision record needs alternatives, risks, selected outcome, testable
consequences, owner, verifier, and evidence links. This public plan does not
invent those values.

## Evidence checklist

### Design and implementation

- [ ] Contract invariant and trust-boundary table accepted.
- [ ] Threat model and all required data flows match the candidate.
- [ ] Both authority prototypes have complete comparison evidence.
- [ ] Selected authority decision record is published without private identity
      data.
- [ ] Access-control role graph matches code and tests.
- [ ] Timelock Controller is the sole delay authority.
- [ ] Legacy inline upgrade authority is absent or permanently closed.
- [ ] Storage schema, migration, TTL, and event specifications are complete.

### Custody and operations

- [ ] Private custodian register contains owners, devices, backups, and contact
      paths.
- [ ] Public A/B/C responsibilities are current.
- [ ] No operator or system controls two keys.
- [ ] Rotation, one-key loss, compromise, and two-key-loss runbooks are
      rehearsed.
- [ ] External, hardware, and offline signing paths are proven.
- [ ] Request, signature, envelope, and operation IDs independently reproduce.

### Build and configuration

- [ ] Optimized WASM is reproducible from the exact source commit.
- [ ] Generated bindings match the interface.
- [ ] Candidate manifest generates SDK, CLI, agent, and documentation mapping.
- [ ] Missing or stale mainnet mapping fails closed.
- [ ] Package tarballs map to committed source and pass clean typed imports.

### Chain activation

- [ ] Circle code and issuer are reverified from the current official source.
- [ ] USDC Stellar Asset Contract ID is independently derived and read from
      mainnet.
- [ ] Deployment request matches the exact candidate and role configuration.
- [ ] Observed MandateRegistry ID and state match the signed manifest.
- [ ] Unauthorized probes fail before payment funding.

### Canary

- [ ] Canary wallets hold only the approved bounded value.
- [ ] Mandate merchant, asset, budget, expiry, and agent are exact.
- [ ] Allowance spender is the MandateRegistry and lifetime is bounded.
- [ ] Payment validates, consumes, and transfers atomically.
- [ ] Merchant verification and durable fulfillment succeed.
- [ ] Exact recovery produces no second payment.
- [ ] Balances, events, sequence, spent value, receipt, and delivery agree.
- [ ] Mandate is revoked or expires and remaining allowance is handled.

## Stop conditions

Stop before deployment or payment if any of these is true:

- either local or remote source state differs from the candidate manifest;
- the optimized WASM is not reproducible;
- either authority prototype reveals a one-key bypass;
- any privileged function has an alternate administrator or delay path;
- bootstrap authority is still active;
- role, signer, threshold, pause, asset, delay, or storage state is ambiguous;
- any valid signer pair fails or any invalid signer combination succeeds;
- hardware or offline signers cannot inspect the exact effect;
- the request, signature, envelope, operation ID, and simulation do not agree;
- threat model or data-flow inputs are incomplete;
- a critical or high-severity finding is unresolved;
- the Circle asset identity is not reverified;
- the USDC Stellar Asset Contract derivations disagree;
- the observed MandateRegistry identity or state differs from the signed
  manifest;
- RPC endpoints disagree on critical state;
- generated package, CLI, agent, site, and contract mappings differ;
- recovery requires a second payment;
- a store or RPC failure opens rather than closes the flow;
- canary funding exceeds the approved bound; or
- an operator proposes inventing an ID, owner, date, result, or exception.

After deployment, any mismatch keeps payment funding at zero. After the canary,
any unexplained settlement, authority, mapping, or recovery discrepancy freezes
expansion and invokes the incident path.

## Official references

- [OpenZeppelin Stellar role-based access control](https://docs.openzeppelin.com/stellar-contracts/access/access-control)
- [OpenZeppelin Stellar Timelock Controller](https://docs.openzeppelin.com/stellar-contracts/governance/timelock-controller)
- [OpenZeppelin Stellar smart accounts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account)
- [OpenZeppelin Stellar threshold policies](https://docs.openzeppelin.com/stellar-contracts/accounts/policies)
- [OpenZeppelin Stellar signers and verifiers](https://docs.openzeppelin.com/stellar-contracts/accounts/signers-and-verifiers)
- [OpenZeppelin Stellar pause utility](https://docs.openzeppelin.com/stellar-contracts/utils/pausable)
- [OpenZeppelin Stellar upgrades and migrations](https://docs.openzeppelin.com/stellar-contracts/utils/upgradeable)
- [Stellar signatures and multisig](https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig)
- [Stellar smart-contract authorization](https://developers.stellar.org/docs/build/guides/auth/contract-authorization)
- [Stellar contract accounts](https://developers.stellar.org/docs/build/guides/contract-accounts)
- [Stellar Asset Contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
- [Stellar CLI asset-contract derivation and deployment](https://developers.stellar.org/docs/tools/cli/cookbook/deploy-stellar-asset-contract)
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)

## Related Ackrate documents

- [Mainnet delivery roadmap](mainnet-roadmap.md)
- [Current MandateRegistry testnet evidence](mandate-registry-contract.md)
- [Current x402 round trip](x402-roundtrip.md)
- [Current threat model](../security/threat-model.md)
- [Current data flows](../security/data-flow.md)
- [Live testnet failure drills](live-failure-drills.md)
