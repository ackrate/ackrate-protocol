import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Buffer } from "buffer";
import { Asset, Keypair, Networks, StrKey, xdr } from "@stellar/stellar-sdk";
import { TESTNET } from "@ackrate/stellar";
import {
  createStellarPaymentVerifier,
  extractContractEvents,
  interpretEvents,
  selectPayment,
  selectTransfer,
  type DecodedEvent,
  type DecodedValue,
  type LoadedMandate,
  type LoadedTransaction,
} from "./verification.js";
import type { PaymentRequirement } from "./types.js";

const user = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const agent = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();
const merchant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const otherMerchant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 10)).publicKey();
const mandateId = Buffer.alloc(32, 11);
const price = 10_000_000n;

const value = (type: string, native: unknown): DecodedValue => ({ type, value: native });
const paymentEvent = (overrides: Partial<DecodedEvent> = {}): DecodedEvent => ({
  type: "contract",
  contractId: TESTNET.mandateRegistryId,
  topics: [value("scvSymbol", "payment"), value("scvAddress", merchant)],
  data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", price)]),
  ...overrides,
});
const transferEvent = (overrides: Partial<DecodedEvent> = {}): DecodedEvent => ({
  type: "contract",
  contractId: TESTNET.nativeSac,
  topics: [
    value("scvSymbol", "transfer"),
    value("scvAddress", user),
    value("scvAddress", merchant),
    value("scvString", "native"),
  ],
  data: value("scvI128", price),
  ...overrides,
});

const requirement: PaymentRequirement = {
  scheme: "ackrate-soroban",
  network: "stellar-testnet",
  resource: "/source/market",
  merchant,
  asset: TESTNET.nativeSac,
  amount: "1.00",
  amountStroops: price,
  registryId: TESTNET.mandateRegistryId,
  decimals: 7,
};

const successTransaction = (): LoadedTransaction => ({
  status: "SUCCESS",
  ledger: 100,
  latestLedger: 110,
  events: [transferEvent(), paymentEvent()],
});
const storedMandate = (): LoadedMandate => ({
  user,
  agent,
  merchant,
  asset: TESTNET.nativeSac,
});

function verifierWith(options: {
  transaction?: LoadedTransaction | (() => Promise<LoadedTransaction>);
  mandate?: LoadedMandate | (() => Promise<LoadedMandate>);
  passphrase?: string | (() => Promise<string>);
  pollAttempts?: number;
  maxProofAgeLedgers?: number;
} = {}) {
  const transaction = options.transaction ?? successTransaction();
  const mandate = options.mandate ?? storedMandate();
  const passphrase = options.passphrase ?? TESTNET.networkPassphrase;
  return createStellarPaymentVerifier({
    networkConfig: TESTNET,
    pollAttempts: options.pollAttempts ?? 0,
    pollIntervalMs: 0,
    maxProofAgeLedgers: options.maxProofAgeLedgers,
    wait: async () => undefined,
    loadNetworkPassphrase: typeof passphrase === "function" ? passphrase : async () => passphrase,
    loadTransaction: typeof transaction === "function" ? transaction : async () => transaction,
    loadMandate: typeof mandate === "function" ? mandate : async () => mandate,
  });
}

test("golden V4 metadata retains the exact payment and transfer event types", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../../../apps/fulfillment-agent/src/fixtures/payment-meta.json", import.meta.url),
    "utf8",
  )) as { metaXdr: string; registryId: string };
  const events = interpretEvents(extractContractEvents(xdr.TransactionMeta.fromXDR(fixture.metaXdr, "base64")));
  assert.equal(events.length, 2);
  const payment = selectPayment(events, {
    merchant: "GCREL554SPELMSCEIQQVYS2TPDWONZ6AVQXMUNBEGGZ2X5FNYHDC2RZG",
    registryId: fixture.registryId,
    priceStroops: price,
  });
  assert.equal(payment.ok, true);
  const transfer = selectTransfer(events, {
    asset: TESTNET.nativeSac,
    user: "GBE3PH4ZYVYUXZWZL4YJP22H5J46U6VQVF6SYNJ3GGU3RHBN4M77VNBG",
    merchant: "GCREL554SPELMSCEIQQVYS2TPDWONZ6AVQXMUNBEGGZ2X5FNYHDC2RZG",
    amount: price,
  });
  assert.deepEqual(transfer, { ok: true });
});

test("selectPayment accepts one exact trusted event and scans past underpayment", () => {
  const under = paymentEvent({
    data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", price - 1n)]),
  });
  const result = selectPayment([under, paymentEvent()], {
    merchant,
    registryId: TESTNET.mandateRegistryId,
    priceStroops: price,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.amount, price);
    assert.deepEqual(result.mandateId, mandateId);
  }
});

test("selectPayment rejects ambiguity instead of choosing the first event", () => {
  const result = selectPayment([paymentEvent(), paymentEvent()], {
    merchant,
    registryId: TESTNET.mandateRegistryId,
    priceStroops: price,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /multiple/);
});

test("selectPayment rejects wrong emitters, event types, topics, and payload discriminants", () => {
  const check = { merchant, registryId: TESTNET.mandateRegistryId, priceStroops: price };
  const cases: DecodedEvent[] = [
    paymentEvent({ contractId: TESTNET.nativeSac }),
    paymentEvent({ contractId: null }),
    paymentEvent({ type: "diagnostic" }),
    paymentEvent({ topics: [value("scvString", "payment"), value("scvAddress", merchant)] }),
    paymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", otherMerchant)] }),
    paymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", merchant), value("scvVoid", null)] }),
    paymentEvent({ data: value("scvVec", [value("scvString", mandateId.toString("hex")), value("scvI128", price)]) }),
    paymentEvent({ data: value("scvVec", [value("scvBytes", Buffer.alloc(31)), value("scvI128", price)]) }),
    paymentEvent({ data: value("scvVec", [value("scvBytes", mandateId), value("scvU64", price)]) }),
    paymentEvent({ data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", 0n)]) }),
  ];
  for (const candidate of cases) assert.equal(selectPayment([candidate], check).ok, false);
});

test("selectTransfer requires one exact asset-emitted user-to-merchant transfer", () => {
  const check = { asset: TESTNET.nativeSac, user, merchant, amount: price };
  assert.deepEqual(selectTransfer([transferEvent()], check), { ok: true });
  const cases: DecodedEvent[] = [
    transferEvent({ contractId: TESTNET.mandateRegistryId }),
    transferEvent({ type: "system" }),
    transferEvent({ topics: [value("scvString", "transfer"), value("scvAddress", user), value("scvAddress", merchant)] }),
    transferEvent({ topics: [value("scvSymbol", "transfer"), value("scvAddress", agent), value("scvAddress", merchant)] }),
    transferEvent({ topics: [value("scvSymbol", "transfer"), value("scvAddress", user), value("scvAddress", otherMerchant)] }),
    transferEvent({ data: value("scvI128", price - 1n) }),
  ];
  for (const candidate of cases) assert.equal(selectTransfer([candidate], check).ok, false);
  assert.equal(selectTransfer([transferEvent(), transferEvent()], check).ok, false);
});

test("verifier returns only chain-derived settlement fields", async () => {
  const result = await verifierWith().verify("A".repeat(64), requirement);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payment.txHash, "a".repeat(64));
    assert.equal(result.payment.mandateId, mandateId.toString("hex"));
    assert.equal(result.payment.amount, "1");
    assert.equal(result.payment.amountStroops, price);
    assert.equal(result.payment.user, user);
    assert.equal(result.payment.agent, agent);
    assert.equal(result.payment.ledger, 100);
  }
});

test("verifier rejects stored mandate merchant and asset mismatches", async () => {
  const wrongMerchant = await verifierWith({ mandate: { ...storedMandate(), merchant: otherMerchant } })
    .verify("a".repeat(64), requirement);
  assert.equal(wrongMerchant.ok, false);
  if (!wrongMerchant.ok) assert.match(wrongMerchant.reason, /stored mandate merchant/);

  const wrongAsset = await verifierWith({ mandate: { ...storedMandate(), asset: TESTNET.mandateRegistryId } })
    .verify("a".repeat(64), requirement);
  assert.equal(wrongAsset.ok, false);
  if (!wrongAsset.ok) assert.match(wrongAsset.reason, /stored mandate asset/);
});

test("verifier rejects a registry payment without the matching SEP-41 transfer", async () => {
  const result = await verifierWith({
    transaction: { ...successTransaction(), events: [paymentEvent(), transferEvent({ data: value("scvI128", price - 1n) })] },
  }).verify("a".repeat(64), requirement);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /matching transfer/);
});

test("verifier rejects failed, stale, future, and incomplete transaction evidence", async () => {
  const failed = await verifierWith({ transaction: { status: "FAILED", ledger: 100, latestLedger: 100 } })
    .verify("a".repeat(64), requirement);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.kind, "invalid");

  const stale = await verifierWith({ transaction: { ...successTransaction(), ledger: 1, latestLedger: 200 }, maxProofAgeLedgers: 10 })
    .verify("a".repeat(64), requirement);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.reason, /freshness/);

  const future = await verifierWith({ transaction: { ...successTransaction(), ledger: 201, latestLedger: 200 } })
    .verify("a".repeat(64), requirement);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.kind, "unavailable");

  const incomplete = await verifierWith({ transaction: { status: "SUCCESS", events: successTransaction().events } })
    .verify("a".repeat(64), requirement);
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.kind, "unavailable");
});

test("verifier polls NOT_FOUND and classifies RPC and mandate lookup faults unavailable", async () => {
  let reads = 0;
  const missing = await verifierWith({
    pollAttempts: 2,
    transaction: async () => {
      reads += 1;
      return { status: "NOT_FOUND", latestLedger: 100 };
    },
  }).verify("a".repeat(64), requirement);
  assert.equal(reads, 3);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.kind, "unavailable");

  const rpcFault = await verifierWith({ transaction: async () => { throw new Error("rpc offline"); } })
    .verify("a".repeat(64), requirement);
  assert.equal(rpcFault.ok, false);
  if (!rpcFault.ok) assert.match(rpcFault.reason, /rpc offline/);

  const mandateFault = await verifierWith({ mandate: async () => { throw new Error("NotFound"); } })
    .verify("a".repeat(64), requirement);
  assert.equal(mandateFault.ok, false);
  if (!mandateFault.ok) assert.equal(mandateFault.kind, "unavailable");
});

test("verifier checks RPC network identity before trusting transaction data", async () => {
  const mismatch = await verifierWith({ passphrase: "Public Global Stellar Network ; September 2015" })
    .verify("a".repeat(64), requirement);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.kind, "unavailable");
    assert.match(mismatch.reason, /passphrase/);
  }
});

test("verifier rejects noncanonical hashes and insecure RPC by default", async () => {
  const badHash = await verifierWith().verify("z".repeat(64), requirement);
  assert.equal(badHash.ok, false);
  assert.throws(() => createStellarPaymentVerifier({
    networkConfig: { ...TESTNET, rpcUrl: "http://127.0.0.1:8000" },
    loadMandate: async () => storedMandate(),
  }), /https/);
});

const v2PaymentEvent = (overrides: Partial<DecodedEvent> = {}): DecodedEvent => ({
  ...paymentEvent(),
  topics: [value("scvSymbol", "payment"), value("scvAddress", merchant), value("scvAddress", TESTNET.nativeSac)],
  data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", price), value("scvU32", 2)]),
  ...overrides,
});
const v2Mandate = (): LoadedMandate => ({ ...storedMandate(), seq: 3, spent: price * 3n });
const v2Transaction = (events: DecodedEvent[] = [transferEvent(), v2PaymentEvent()]): LoadedTransaction => ({
  ...successTransaction(), events,
});
const v2Check = { merchant, registryId: TESTNET.mandateRegistryId, priceStroops: price, asset: TESTNET.nativeSac };

test("V2 accepts contract-address merchants and users with an exact transfer and an Ed25519 agent", async () => {
  const contractMerchant = StrKey.encodeContract(Buffer.alloc(32, 41));
  const contractUser = StrKey.encodeContract(Buffer.alloc(32, 42));
  for (const [payer, payee] of [[user, contractMerchant], [contractUser, merchant], [contractUser, contractMerchant]]) {
    const events = [
      transferEvent({ topics: [value("scvSymbol", "transfer"), value("scvAddress", payer), value("scvAddress", payee)] }),
      v2PaymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", payee), value("scvAddress", TESTNET.nativeSac)] }),
    ];
    const result = await verifierWith({ transaction: v2Transaction(events), mandate: { ...v2Mandate(), user: payer!, merchant: payee! } })
      .verify("a".repeat(64), { ...requirement, merchant: payee! });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payment.user, payer);
      assert.equal(result.payment.merchant, payee);
      assert.equal(result.payment.agent, agent);
    }
  }
});

test("V2 rejects malformed merchant addresses even when every injected claim agrees", async () => {
  const contractMerchant = StrKey.encodeContract(Buffer.alloc(32, 41));
  for (const payee of ["not-an-address", "C".repeat(56), contractMerchant.toLowerCase(), ` ${contractMerchant}`, `${contractMerchant} `]) {
    const events = [
      transferEvent({ topics: [value("scvSymbol", "transfer"), value("scvAddress", user), value("scvAddress", payee)] }),
      v2PaymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", payee), value("scvAddress", TESTNET.nativeSac)] }),
    ];
    const result = await verifierWith({ transaction: v2Transaction(events), mandate: { ...v2Mandate(), merchant: payee } })
      .verify("a".repeat(64), { ...requirement, merchant: payee });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /invalid user or merchant address/);
  }
});

test("V2 selection binds the explicit asset and retains the consumed sequence without changing token evidence", () => {
  const events = [transferEvent(), v2PaymentEvent()];
  const original = structuredClone(events);
  const selected = selectPayment(events, v2Check);
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.consumedSequence, 2);
    assert.equal(selected.amount, price);
    assert.deepEqual(selected.mandateId, mandateId);
  }
  assert.deepEqual(structuredClone(events), original);
  const { asset: _asset, ...unboundCheck } = v2Check;
  assert.equal(selectPayment(events, unboundCheck).ok, false, "a V2 asset must never be discarded to fit legacy fields");
});

test("V2 rejects malformed event shape, identity, amount, and sequence discriminants", () => {
  const fields = [value("scvBytes", mandateId), value("scvI128", price), value("scvU32", 2)];
  const cases: DecodedEvent[] = [
    v2PaymentEvent({ type: "diagnostic" }),
    v2PaymentEvent({ contractId: TESTNET.nativeSac }),
    v2PaymentEvent({ topics: [value("scvString", "payment"), value("scvAddress", merchant), value("scvAddress", TESTNET.nativeSac)] }),
    v2PaymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", otherMerchant), value("scvAddress", TESTNET.nativeSac)] }),
    v2PaymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", merchant), value("scvString", TESTNET.nativeSac)] }),
    v2PaymentEvent({ topics: [value("scvSymbol", "payment"), value("scvAddress", merchant), value("scvAddress", TESTNET.mandateRegistryId)] }),
    v2PaymentEvent({ topics: [...v2PaymentEvent().topics, value("scvU32", 0)] }),
    v2PaymentEvent({ topics: v2PaymentEvent().topics.slice(0, 2) }),
    v2PaymentEvent({ data: value("scvVec", fields.slice(0, 2)) }),
    v2PaymentEvent({ data: value("scvVec", [...fields, value("scvVoid", null)]) }),
    v2PaymentEvent({ data: value("scvVec", [value("scvBytes", Buffer.alloc(31)), ...fields.slice(1)]) }),
    v2PaymentEvent({ data: value("scvVec", [value("scvString", mandateId.toString("hex")), ...fields.slice(1)]) }),
    ...[value("scvI128", 0n), value("scvI128", -1n), value("scvI128", 1n << 127n), value("scvI128", Number(price)), value("scvU64", price)]
      .map((amount) => v2PaymentEvent({ data: value("scvVec", [fields[0]!, amount, fields[2]!]) })),
    ...[value("scvI128", 2n), value("scvU32", 2n), value("scvU32", "2"), value("scvU32", -1),
      value("scvU32", 1.5), value("scvU32", Number.NaN), value("scvU32", 0xffff_ffff)]
      .map((sequence) => v2PaymentEvent({ data: value("scvVec", [fields[0]!, fields[1]!, sequence]) })),
  ];
  for (const candidate of cases) assert.equal(selectPayment([candidate], v2Check).ok, false);
});

test("V2 requires the exact service price while legacy price-floor semantics remain unchanged", () => {
  for (const amount of [price - 1n, price + 1n]) {
    const candidate = v2PaymentEvent({ data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", amount), value("scvU32", 2)]) });
    const result = selectPayment([candidate], v2Check);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /exact service price/);
  }
  const legacyOverpayment = paymentEvent({ data: value("scvVec", [value("scvBytes", mandateId), value("scvI128", price + 1n)]) });
  assert.equal(selectPayment([legacyOverpayment], v2Check).ok, true);
});

test("V2 rejects duplicate or mixed-schema eligible payments and never ignores malformed target events", () => {
  for (const events of [
    [v2PaymentEvent(), v2PaymentEvent()],
    [paymentEvent(), v2PaymentEvent()],
    [v2PaymentEvent(), v2PaymentEvent({ data: value("scvVec", []) })],
  ]) assert.equal(selectPayment(events, v2Check).ok, false);
});

test("V2 requires chain accounting to confirm the consumed sequence, allowing later legitimate payments", async () => {
  for (const currentSequence of [3, 5, 0xffff_ffff]) {
    const result = await verifierWith({ transaction: v2Transaction(), mandate: { ...v2Mandate(), seq: currentSequence } })
      .verify("a".repeat(64), requirement);
    assert.equal(result.ok, true);
  }
  const changes: Partial<LoadedMandate>[] = [
    { seq: undefined }, { seq: 0 }, { seq: 2 }, { seq: -1 }, { seq: 3.5 }, { seq: Number.NaN }, { seq: 0x1_0000_0000 },
    { spent: undefined }, { spent: price - 1n }, { spent: -1n }, { spent: 1n << 127n },
    { user: "not-an-account" }, { agent: "not-an-account" }, { agent: TESTNET.nativeSac },
    { merchant: otherMerchant }, { asset: TESTNET.mandateRegistryId },
  ];
  for (const change of changes) {
    const result = await verifierWith({ transaction: v2Transaction(), mandate: { ...v2Mandate(), ...change } })
      .verify("a".repeat(64), requirement);
    assert.equal(result.ok, false);
  }
});

test("V2 still requires exactly one matching token transfer from the stored user", async () => {
  const badTransfers = [
    [], [transferEvent(), transferEvent()],
    [transferEvent({ contractId: TESTNET.mandateRegistryId })],
    [transferEvent({ topics: [value("scvSymbol", "transfer"), value("scvAddress", agent), value("scvAddress", merchant)] })],
    [transferEvent({ data: value("scvI128", price - 1n) })],
    [transferEvent({ data: value("scvI128", price + 1n) })],
  ];
  for (const transfers of badTransfers) {
    const result = await verifierWith({ transaction: v2Transaction([...transfers, v2PaymentEvent()]), mandate: v2Mandate() })
      .verify("a".repeat(64), requirement);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /transfer/);
  }
});

test("V2 cannot cross configured registry, network, or transaction freshness boundaries", async () => {
  for (const change of [{ registryId: TESTNET.nativeSac }, { network: "stellar-mainnet" }, { asset: TESTNET.mandateRegistryId }]) {
    const result = await verifierWith({ transaction: v2Transaction(), mandate: v2Mandate() })
      .verify("a".repeat(64), { ...requirement, ...change });
    assert.equal(result.ok, false);
  }
  for (const transaction of [
    { ...v2Transaction(), status: "FAILED" },
    { ...v2Transaction(), ledger: 1, latestLedger: 200 },
    { ...v2Transaction(), ledger: 201, latestLedger: 200 },
  ]) assert.equal((await verifierWith({ transaction, mandate: v2Mandate() }).verify("a".repeat(64), requirement)).ok, false);
});

test("recorded Mainnet V2 metadata verifies only at a fresh historical ledger with the exact USDC transfer", async (t) => {
  const networkGuard = t.mock.method(globalThis, "fetch", async () => { throw new Error("Fixture verification cannot access the network"); });
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/mainnet-v2-payment.json", import.meta.url), "utf8")) as {
    txHash: string; status: string; ledger: number; latestLedger: number; resultMetaXdr: string;
  };
  assert.equal(fixture.txHash, "b6613ca58ec4723d41957c8bf90bfb44be069d6443f343736f5fda48df1a0467");
  assert.equal(fixture.ledger, 64286275);
  const registry = "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR";
  const asset = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
  const historicalUser = "GCHNDR6APAMBLIAYTQRCKDHQRBI3E2V5GE6KIRUBXROLHRS46NF5YDVV";
  const historicalMerchant = "GBALWVF5IYJUW6NBQE7UIOM2JRZIFMMS7OXFDWSYRHU2GUPS3OUM5ZSZ";
  const historicalId = "e21128d9871ea317f003c86ea746e094ebd7496207e9e88b7429a0096bf94cde";
  const events = interpretEvents(extractContractEvents(xdr.TransactionMeta.fromXDR(fixture.resultMetaXdr, "base64")));
  const price = 200000n;
  const selected = selectPayment(events, { registryId: registry, merchant: historicalMerchant, asset, priceStroops: price });
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.mandateId.toString("hex"), historicalId);
    assert.equal(selected.consumedSequence, 0);
  }
  const atLedger = (latestLedger: number) => createStellarPaymentVerifier({
    networkConfig: { rpcUrl: "https://fixture.invalid", networkPassphrase: Networks.PUBLIC, mandateRegistryId: registry,
      nativeSac: Asset.native().contractId(Networks.PUBLIC) },
    loadNetworkPassphrase: async () => Networks.PUBLIC,
    loadTransaction: async () => ({ status: fixture.status, ledger: fixture.ledger, latestLedger, events }),
    // Model the state after this historical sequence 0; this is not a live chain read.
    loadMandate: async (id) => {
      assert.equal(id.toString("hex"), historicalId);
      return { user: historicalUser, agent: historicalMerchant, merchant: historicalMerchant, asset, seq: 1, spent: price };
    },
  }).verify(fixture.txHash, { ...requirement, scheme: "ackrate-soroban-bound", network: "stellar-mainnet", registryId: registry,
    merchant: historicalMerchant, asset, amount: "0.02", amountStroops: price });
  assert.equal((await atLedger(fixture.ledger)).ok, true);
  const stale = await atLedger(fixture.latestLedger);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.reason, /freshness/);
  assert.equal(networkGuard.mock.callCount(), 0);
});
