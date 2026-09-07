import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import { Keypair, hash, rpc } from "@stellar/stellar-sdk";
import {
  BOUND_PAYMENT_CAPABILITY,
  BOUND_PAYMENT_SCHEME,
  DeliveryPendingError,
  SettlementUncertainError,
  ACKRATE_PAYMENT_CAPABILITIES_HEADER,
  createSettlementReceiptId,
  getSettlementReceipt,
  isBoundPaymentProof,
  ackrate,
  decodePaymentProof,
  X_PAYMENT_HEADER,
  type BoundPaymentChallengeV2,
  type SettlementReceipt,
  type SettlementReceiptStore,
} from "@ackrate/core";

// Unit coverage for the Agent.fetch x402 orchestration: the 402 handling, the
// pre-flight merchant/asset checks, the on-chain settle, and the proof-carrying
// retry. We stub global fetch (no network) and override pay (no chain), so this
// tests the HTTP glue in isolation. The contract and the merchant remain the real
// security boundaries; here we only assert fetch wires them together correctly.

const MERCHANT = "GMERCHANT_TEST_ADDRESS";
const ASSET = "CASSET_TEST_CONTRACT";
const TARGET = "https://merchant.example/source/market";
const TXHASH = "a".repeat(64);

function memoryReceiptStore(): SettlementReceiptStore {
  const pending = new Map<string, Parameters<SettlementReceiptStore["savePending"]>[0]>();
  return {
    async savePending(receipt) { pending.set(receipt.receiptId, receipt); },
    async clearPending(receiptId) { pending.delete(receiptId); },
    async listPending() { return [...pending.values()]; },
  };
}

function recoveryReceipt(mandateId: string, txHash = TXHASH, network = "stellar-testnet"): Readonly<SettlementReceipt> {
  const evidence = {
    proofVersion: 1 as const,
    url: TARGET,
    method: "GET",
    txHash,
    mandateId,
    amount: "1.00",
    submittedAt: 1_700_000_000,
    validUntil: 1_700_000_060,
    proof: { scheme: "ackrate-soroban", network, txHash, mandateId, amount: "1.00" },
  };
  return Object.freeze({ ...evidence, receiptId: createSettlementReceiptId(evidence) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function mainnetRecoveryFixture() {
  let signs = 0;
  const signer = {
    publicKey: Keypair.random().publicKey(),
    signTransaction: async (): Promise<never> => { signs += 1; throw new Error("must never sign"); },
  };
  const mandate = ackrate.createIntentMandate({
    user: signer.publicKey, agent: signer.publicKey, merchant: MERCHANT,
    asset: ackrate.mainnet.settlementAsset.contractId, maxAmount: "2", expiry: 1_900_000_000,
  });
  const receiptStore = memoryReceiptStore();
  const receipt = recoveryReceipt(mandate.id, TXHASH, "stellar-mainnet");
  await receiptStore.savePending(receipt);
  const make = () => ackrate.agent({ mandate, signer, receiptStore }, ackrate.mainnet);
  return { receipt, receiptStore, make, signs: () => signs };
}

for (const failure of ["wrong network", "identity unavailable", "transaction unavailable"] as const) {
  test(`reconciliation retains Mainnet evidence when RPC reports ${failure}`, async (t) => {
    const fixture = await mainnetRecoveryFixture();
    const original = fixture.make();
    const recovery = fixture.make();
    let reads = 0;
    let clears = 0;
    let broadcasts = 0;
    const clear = fixture.receiptStore.clearPending;
    t.mock.method(fixture.receiptStore, "clearPending", async (id: string) => { clears += 1; await clear(id); });
    t.mock.method(rpc.Server.prototype, "getNetwork", async () => {
      if (failure === "identity unavailable") throw new Error("identity unavailable");
      return { passphrase: failure === "wrong network" ? ackrate.testnet.networkPassphrase : ackrate.mainnet.networkPassphrase };
    });
    t.mock.method(rpc.Server.prototype, "getTransaction", async () => {
      reads += 1;
      if (failure === "transaction unavailable") throw new Error("transaction unavailable");
      return { status: "NOT_FOUND", latestLedgerCloseTime: 1_700_000_120, oldestLedgerCloseTime: 1_700_000_000 };
    });
    t.mock.method(rpc.Server.prototype, "sendTransaction", async () => { broadcasts += 1; throw new Error("must never broadcast"); });
    t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected HTTP request"); });
    try {
      await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
      await assert.rejects(() => recovery.reconcilePendingSettlement(), /network identity|identity unavailable|transaction unavailable/);
      assert.equal(reads, failure === "transaction unavailable" ? 1 : 0);
      assert.equal(clears, 0);
      assert.deepEqual(await fixture.receiptStore.listPending(), [fixture.receipt]);
      assert.equal(original.getPendingSettlement()?.txHash, fixture.receipt.txHash);
      assert.equal(recovery.getPendingSettlement()?.txHash, fixture.receipt.txHash);
      await assert.rejects(() => fixture.make().pay("1", { onPrepared() {} }), /already active/);
      assert.equal(fixture.signs(), 0);
      assert.equal(broadcasts, 0);
    } finally {
      await recovery.acknowledgeDelivery(fixture.receipt);
    }
  });
}

test("matching network and complete expired RPC history release all shared recovery owners", async (t) => {
  const fixture = await mainnetRecoveryFixture();
  const original = fixture.make();
  const recovery = fixture.make();
  const calls: string[] = [];
  t.mock.method(rpc.Server.prototype, "getNetwork", async () => {
    calls.push("network");
    return { passphrase: ackrate.mainnet.networkPassphrase };
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async (hash: string) => {
    calls.push(hash);
    return { status: "NOT_FOUND", latestLedgerCloseTime: 1_700_000_120, oldestLedgerCloseTime: 1_700_000_000 };
  });
  t.mock.method(globalThis, "fetch", async () => new Response("free response"));
  await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
  assert.equal((await recovery.reconcilePendingSettlement()).kind, "expired");
  assert.deepEqual(calls, ["network", fixture.receipt.txHash]);
  assert.equal((await fixture.receiptStore.listPending()).length, 0);
  assert.equal(original.getPendingSettlement(), undefined);
  assert.equal(recovery.getPendingSettlement(), undefined);
  assert.equal((await original.fetch(TARGET)).status, 200);
  assert.equal(fixture.signs(), 0);
});

test("malformed NOT_FOUND history retains receipts and every shared payment claim", async (t) => {
  const validHistory = { latestLedgerCloseTime: 1_700_000_120, oldestLedgerCloseTime: 1_700_000_000 };
  const cases: { name: string; history: Record<string, unknown> }[] = [
    { name: "missing both bounds", history: {} },
    { name: "missing latest bound", history: { oldestLedgerCloseTime: validHistory.oldestLedgerCloseTime } },
    { name: "missing oldest bound", history: { latestLedgerCloseTime: validHistory.latestLedgerCloseTime } },
    { name: "reversed bounds", history: { ...validHistory, oldestLedgerCloseTime: validHistory.latestLedgerCloseTime + 1 } },
  ];
  for (const field of ["latestLedgerCloseTime", "oldestLedgerCloseTime"] as const) {
    for (const [name, value] of [
      ["NaN", NaN], ["positive infinity", Infinity], ["negative infinity", -Infinity],
      ["zero", 0], ["negative", -1], ["fractional", validHistory[field] - 0.5],
      ["unsafe integer", Number.MAX_SAFE_INTEGER + 1], ["numeric string", String(validHistory[field])],
      ["null", null], ["boolean", true],
    ] as const) {
      cases.push({ name: `${field}: ${name}`, history: { ...validHistory, [field]: value } });
    }
  }
  for (const { name, history } of cases) {
    await t.test(name, async (t) => {
      const fixture = await mainnetRecoveryFixture();
      const original = fixture.make();
      const recovery = fixture.make();
      let clears = 0;
      let broadcasts = 0;
      const clear = fixture.receiptStore.clearPending;
      t.mock.method(fixture.receiptStore, "clearPending", async (id: string) => { clears += 1; await clear(id); });
      t.mock.method(rpc.Server.prototype, "getNetwork", async () => ({ passphrase: ackrate.mainnet.networkPassphrase }));
      t.mock.method(rpc.Server.prototype, "getTransaction", async (hash: string) => {
        assert.equal(hash, fixture.receipt.txHash);
        return { status: "NOT_FOUND", ...history };
      });
      t.mock.method(rpc.Server.prototype, "sendTransaction", async () => { broadcasts += 1; throw new Error("must never broadcast"); });
      t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected HTTP request"); });
      try {
        await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
        const result = await recovery.reconcilePendingSettlement();
        assert.equal(result.kind, "pending");
        assert.equal(clears, 0);
        assert.deepEqual(await fixture.receiptStore.listPending(), [fixture.receipt]);
        assert.equal(original.getPendingSettlement()?.txHash, fixture.receipt.txHash);
        assert.equal(recovery.getPendingSettlement()?.txHash, fixture.receipt.txHash);
        await assert.rejects(() => original.pay("1", { onPrepared() {} }), /already active/);
        await assert.rejects(() => recovery.pay("1", { onPrepared() {} }), /already active/);
        await assert.rejects(() => fixture.make().pay("1", { onPrepared() {} }), /already active/);
        assert.equal(fixture.signs(), 0);
        assert.equal(broadcasts, 0);
      } finally {
        await recovery.acknowledgeDelivery(fixture.receipt);
      }
    });
  }
});

test("a late reconciliation response cannot clear a newer claim on the same Agent", async (t) => {
  const fixture = await mainnetRecoveryFixture();
  const original = fixture.make();
  const alternate = fixture.make();
  const started = deferred<void>();
  const reply = deferred<{ status: string; latestLedgerCloseTime: number; oldestLedgerCloseTime: number }>();
  t.mock.method(rpc.Server.prototype, "getNetwork", async () => ({ passphrase: ackrate.mainnet.networkPassphrase }));
  t.mock.method(rpc.Server.prototype, "getTransaction", async () => { started.resolve(); return reply.promise; });
  t.mock.method(globalThis, "fetch", async () => new Response("recovered"));
  await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
  const reconciliation = original.reconcilePendingSettlement();
  const rejected = assert.rejects(reconciliation, /operation changed/);
  await started.promise;
  await alternate.acknowledgeDelivery(fixture.receipt);
  const next = recoveryReceipt(fixture.receipt.mandateId, "b".repeat(64), "stellar-mainnet");
  await fixture.receiptStore.savePending(next);
  await original.retryDelivery(next);
  reply.resolve({ status: "NOT_FOUND", latestLedgerCloseTime: 1_700_000_120, oldestLedgerCloseTime: 1_700_000_000 });
  await rejected;
  assert.equal(original.getPendingSettlement()?.txHash, next.txHash);
  assert.deepEqual(await fixture.receiptStore.listPending(), [next]);
  await assert.rejects(() => fixture.make().pay("1", { onPrepared() {} }), /already active/);
  await alternate.acknowledgeDelivery(next);
  assert.equal(original.getPendingSettlement(), undefined);
  assert.equal(fixture.signs(), 0);
});

test("a late acknowledgment cannot release a newer claim on the same Agent", async (t) => {
  const fixture = await mainnetRecoveryFixture();
  const original = fixture.make();
  const alternate = fixture.make();
  const started = deferred<void>();
  const finish = deferred<void>();
  const clear = fixture.receiptStore.clearPending;
  let clears = 0;
  t.mock.method(fixture.receiptStore, "clearPending", async (id: string) => {
    clears += 1;
    if (clears === 1) { started.resolve(); await finish.promise; }
    await clear(id);
  });
  t.mock.method(globalThis, "fetch", async () => new Response("recovered"));
  await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
  const acknowledgment = original.acknowledgeDelivery(fixture.receipt);
  await started.promise;
  await alternate.acknowledgeDelivery(fixture.receipt);
  const next = recoveryReceipt(fixture.receipt.mandateId, "b".repeat(64), "stellar-mainnet");
  await fixture.receiptStore.savePending(next);
  await original.retryDelivery(next);
  finish.resolve();
  await acknowledgment;
  assert.equal(original.getPendingSettlement()?.txHash, next.txHash);
  assert.deepEqual(await fixture.receiptStore.listPending(), [next]);
  await assert.rejects(() => fixture.make().pay("1", { onPrepared() {} }), /already active/);
  await alternate.acknowledgeDelivery(next);
  assert.equal(original.getPendingSettlement(), undefined);
  assert.equal(fixture.signs(), 0);
});

test("exact receipt recovery shares a retained claim across real Agent instances until acknowledgment", async () => {
  const signer = {
    publicKey: Keypair.random().publicKey(),
    signTransaction: async (): Promise<never> => { throw new Error("recovery must never sign"); },
  };
  const mandate = ackrate.createIntentMandate({
    user: signer.publicKey, agent: signer.publicKey, merchant: MERCHANT,
    asset: ASSET, maxAmount: "2", expiry: 1_900_000_000,
  });
  const receiptStore = memoryReceiptStore();
  const receipt = recoveryReceipt(mandate.id);
  await receiptStore.savePending(receipt);
  const make = () => ackrate.agent({ mandate, signer, receiptStore }, ackrate.testnet);
  const original = make();
  const recovery = make();
  const acknowledgment = make();
  const stub = stubFetch(() => new Response("recovered", { status: 200 }));
  try {
    await assert.rejects(() => original.fetch(TARGET), DeliveryPendingError);
    assert.equal(stub.calls.length, 0);
    const response = await recovery.retryDelivery(receipt);
    assert.equal(await response.text(), "recovered");
    assert.equal(getSettlementReceipt(response), receipt);
    await assert.rejects(() => make().pay("1", { onPrepared() {} }), /already active/);
    const different = recoveryReceipt(mandate.id, "b".repeat(64));
    await assert.rejects(() => recovery.retryDelivery(different), /already active|different pending/);
    await assert.rejects(() => acknowledgment.acknowledgeDelivery(different), /already active/);
    assert.equal((await receiptStore.listPending()).length, 1);
    assert.equal(stub.calls.length, 1);
    await acknowledgment.acknowledgeDelivery(receipt);
    assert.equal((await receiptStore.listPending()).length, 0);
    assert.equal(original.getPendingSettlement(), undefined);
    assert.equal(recovery.getPendingSettlement(), undefined);
    assert.equal((await original.fetch(TARGET)).status, 200);
    assert.equal((await make().fetch(TARGET)).status, 200);
  } finally {
    await acknowledgment.acknowledgeDelivery(receipt);
    stub.restore();
  }
});

function makeAgent() {
  const signer = Keypair.random();
  const mandate = ackrate.createIntentMandate({
    user: "GUSER_TEST_ADDRESS",
    agent: signer.publicKey(),
    merchant: MERCHANT,
    asset: ASSET,
    maxAmount: "5.00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  return {
    agent: ackrate.agent({ mandate, signer, receiptStore: memoryReceiptStore() }, ackrate.testnet),
    mandate,
  };
}

/** A 402 challenge naming this mandate's merchant/asset; override per case. */
const challenge402 = (over: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          scheme: "ackrate-soroban",
          network: "stellar-testnet",
          maxAmountRequired: "1.00",
          asset: ASSET,
          payTo: MERCHANT,
          resource: "/source/market",
          extra: {},
          ...over,
        },
      ],
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );

/** Install a scripted global fetch; returns recorded calls and a restore fn. */
function stubFetch(responder: (call: number) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return await responder(calls.length);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("fetch returns a non-402 response unchanged, without paying", async () => {
  const { agent } = makeAgent();
  let paid = false;
  agent.pay = async () => { paid = true; return TXHASH; };
  const stub = stubFetch(() => new Response("the resource", { status: 200 }));
  try {
    const res = await agent.fetch(TARGET);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "the resource");
    assert.equal(paid, false, "must not pay when the server did not ask");
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("same-mandate agents claim synchronously before the first chain read", async (t) => {
  let requests = 0;
  const started = deferred<void>();
  const finish = deferred<void>();
  t.mock.method(rpc.Server.prototype, "getAccount", async () => {
    requests += 1;
    if (requests === 1) {
      started.resolve();
      await finish.promise;
    }
    throw new Error("rpc unavailable");
  });

  const key = Keypair.random();
  const mandate = ackrate.createIntentMandate({
    user: key.publicKey(),
    agent: key.publicKey(),
    merchant: Keypair.random().publicKey(),
    asset: ackrate.testnet.nativeSac,
    maxAmount: "2.00",
    expiry: Math.floor(Date.now() / 1_000) + 3_600,
    nonce: "same-mandate-operation-claim",
  });
  const net = ackrate.testnet;
  const receiptStore = memoryReceiptStore();
  let failReceiptRead = false;
  t.mock.method(receiptStore, "listPending", async () => {
    if (failReceiptRead) throw new Error("receipt store unavailable");
    return [];
  });
  const firstAgent = ackrate.agent({ mandate, signer: key, receiptStore }, net);
  const secondAgent = ackrate.agent({ mandate, signer: key }, net);
  const lifecycle = { onPrepared: async () => undefined };

  const first = firstAgent.pay("1.00", lifecycle);
  const rejected = assert.rejects(first, /rpc unavailable/);
  await started.promise;
  await assert.rejects(
    () => secondAgent.pay("1.00", lifecycle),
    /another payment operation for this mandate is already active/,
  );
  const receipt = recoveryReceipt(mandate.id);
  const recovery = ackrate.agent({ mandate, signer: key, receiptStore: memoryReceiptStore() }, net);
  failReceiptRead = true;
  await assert.rejects(() => firstAgent.reconcilePendingSettlement(), /receipt store unavailable/);
  await assert.rejects(() => secondAgent.pay("1.00", lifecycle), /already active/);
  failReceiptRead = false;
  await assert.rejects(() => firstAgent.reconcilePendingSettlement(), /already active/);
  await assert.rejects(() => secondAgent.reconcilePendingSettlement(), /already active/);
  await assert.rejects(() => firstAgent.retryDelivery(receipt), /already active/);
  await assert.rejects(() => firstAgent.acknowledgeDelivery(receipt), /already active/);
  await assert.rejects(() => recovery.retryDelivery(receipt), /already active/);
  await assert.rejects(() => recovery.acknowledgeDelivery(receipt), /already active/);
  await assert.rejects(() => secondAgent.pay("1.00", lifecycle), /already active/);
  assert.equal(requests, 1, "recovery cannot displace an active payment preparation");
  finish.resolve();
  await rejected;

  await assert.rejects(
    () => secondAgent.pay("1.00", lifecycle),
    (error: unknown) => error instanceof Error && !/already active/.test(error.message),
  );
  assert.equal(requests, 2, "the original failed preparation must release its own claim");
});

test("fetch pays on a 402 and retries with the X-PAYMENT proof", async () => {
  const { agent, mandate } = makeAgent();
  const paidWith: string[] = [];
  agent.pay = async (amount: string) => { paidWith.push(amount); return TXHASH; };
  const stub = stubFetch((call) =>
    call === 1 ? challenge402() : new Response(JSON.stringify({ data: "premium" }), { status: 200 }),
  );
  try {
    const res = await agent.fetch(TARGET);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: "premium" });
    // paid exactly once, for the amount the challenge asked
    assert.deepEqual(paidWith, ["1.00"]);
    // two fetches: the unpaid GET, then the paid retry
    assert.equal(stub.calls.length, 2);
    // the retry carried a well-formed settlement proof for THIS mandate
    const headers = new Headers(stub.calls[1]!.init?.headers);
    const proofHeader = headers.get(X_PAYMENT_HEADER);
    assert.ok(proofHeader, "retry must carry the X-PAYMENT header");
    const proof = decodePaymentProof(proofHeader);
    assert.equal(proof.txHash, TXHASH);
    assert.equal(proof.mandateId, mandate.id);
    assert.equal(proof.amount, "1.00");
  } finally {
    stub.restore();
  }
});

test("fetch refuses to pay a 402 that names a different merchant", async () => {
  const { agent } = makeAgent();
  let paid = false;
  agent.pay = async () => { paid = true; return TXHASH; };
  const stub = stubFetch(() => challenge402({ payTo: "GSOMEONE_ELSE_ADDRESS" }));
  try {
    await assert.rejects(() => agent.fetch(TARGET), /not this mandate's merchant/);
    assert.equal(paid, false, "must not pay a merchant the mandate is not scoped to");
    assert.equal(stub.calls.length, 1, "must not retry after refusing");
  } finally {
    stub.restore();
  }
});

test("fetch refuses to pay a 402 that names a different asset", async () => {
  const { agent } = makeAgent();
  let paid = false;
  agent.pay = async () => { paid = true; return TXHASH; };
  const stub = stubFetch(() => challenge402({ asset: "CDIFFERENT_ASSET" }));
  try {
    await assert.rejects(() => agent.fetch(TARGET), /different asset/);
    assert.equal(paid, false);
  } finally {
    stub.restore();
  }
});

test("post-settlement network failure preserves a receipt and retryDelivery never pays twice", async () => {
  const { agent, mandate } = makeAgent();
  let payCalls = 0;
  agent.pay = async () => {
    payCalls += 1;
    return TXHASH;
  };
  const outage = stubFetch((call) => {
    if (call === 1) return challenge402();
    throw new TypeError("merchant connection refused");
  });

  let pending: DeliveryPendingError | undefined;
  try {
    await agent.fetch(TARGET);
    assert.fail("delivery outage should throw");
  } catch (error) {
    assert.ok(error instanceof DeliveryPendingError);
    pending = error;
  } finally {
    outage.restore();
  }

  assert.ok(pending);
  assert.equal(payCalls, 1);
  assert.equal(pending.receipt.txHash, TXHASH);
  assert.equal(pending.receipt.mandateId, mandate.id);
  assert.equal(pending.receipt.amount, "1.00");
  assert.equal(pending.receipt.url, TARGET);

  const recovery = stubFetch(() => new Response("delivered", { status: 200 }));
  try {
    const response = await agent.retryDelivery(pending.receipt);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "delivered");
    assert.equal(payCalls, 1, "delivery retry must never create a second payment");
    const header = new Headers(recovery.calls[0]?.init?.headers).get(X_PAYMENT_HEADER);
    assert.ok(header);
    assert.deepEqual(decodePaymentProof(header), pending.receipt.proof);
  } finally {
    recovery.restore();
  }
});

for (const status of [402, 409, 503]) {
  test(`post-settlement HTTP ${status} preserves a receipt instead of looking unpaid`, async () => {
    const { agent, mandate } = makeAgent();
    let payCalls = 0;
    agent.pay = async () => {
      payCalls += 1;
      return TXHASH;
    };
    const rejectedDelivery = stubFetch((call) =>
      call === 1
        ? challenge402()
        : new Response(JSON.stringify({ error: "delivery not confirmed" }), { status }),
    );

    let pending: DeliveryPendingError | undefined;
    try {
      await agent.fetch(TARGET);
      assert.fail(`paid HTTP ${status} should be delivery-pending`);
    } catch (error) {
      assert.ok(error instanceof DeliveryPendingError);
      pending = error;
    } finally {
      rejectedDelivery.restore();
    }

    assert.ok(pending);
    assert.equal(payCalls, 1);
    assert.equal(pending.receipt.txHash, TXHASH);
    assert.equal(pending.receipt.mandateId, mandate.id);
    assert.match(String(pending.cause), new RegExp(`HTTP ${status}`));
  });
}

test("retryDelivery rejects a receipt for another mandate before any HTTP request", async () => {
  const { agent } = makeAgent();
  const stub = stubFetch(() => new Response("should not run"));
  try {
    await assert.rejects(() => agent.retryDelivery({
      receiptId: "c".repeat(64),
      proofVersion: 1,
      url: TARGET,
      method: "GET",
      txHash: TXHASH,
      mandateId: "different",
      amount: "1.00",
      submittedAt: 1_700_000_000,
      validUntil: 1_700_000_060,
      proof: {
        scheme: "ackrate-soroban",
        network: "stellar-testnet",
        txHash: TXHASH,
        mandateId: "different",
        amount: "1.00",
      },
    }), /different mandate/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

function makeBoundAgent(receiptStore: SettlementReceiptStore = memoryReceiptStore()) {
  const user = Keypair.random();
  const signer = Keypair.random();
  const merchant = Keypair.random();
  const mandate = ackrate.createIntentMandate({
    user: user.publicKey(),
    agent: signer.publicKey(),
    merchant: merchant.publicKey(),
    asset: ackrate.testnet.nativeSac,
    maxAmount: "5.00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    nonce: "bound-fetch-tests",
  });
  return {
    signer,
    mandate,
    agent: ackrate.agent({
      mandate,
      signer,
      proofPolicy: "bound-v2-only",
      receiptStore,
    }, ackrate.testnet),
  };
}

function boundChallenge(
  mandate: ReturnType<typeof makeBoundAgent>["mandate"],
  challengeOverrides: Partial<BoundPaymentChallengeV2> = {},
  requirementOverrides: Record<string, unknown> = {},
): Response {
  const now = Math.floor(Date.now() / 1000);
  const challenge: BoundPaymentChallengeV2 = {
    proofVersion: 2,
    challengeId: Buffer.alloc(32, 4).toString("base64url"),
    audience: "https://merchant.example",
    scheme: BOUND_PAYMENT_SCHEME,
    method: "GET",
    resource: "/source/market",
    bodySha256: null,
    network: "stellar-testnet",
    networkId: hash(Buffer.from(ackrate.testnet.networkPassphrase, "utf8")).toString("hex"),
    registryId: ackrate.testnet.mandateRegistryId,
    merchant: mandate.merchant,
    asset: mandate.asset,
    amountStroops: "10000000",
    decimals: mandate.decimals,
    issuedAt: now,
    expiresAt: now + 900,
    authorization: {
      algorithm: "hmac-sha256",
      mac: Buffer.alloc(32, 5).toString("base64"),
    },
    ...challengeOverrides,
  };
  return new Response(JSON.stringify({
    x402Version: 1,
    accepts: [{
      scheme: BOUND_PAYMENT_SCHEME,
      network: "stellar-testnet",
      maxAmountRequired: "1.00",
      asset: mandate.asset,
      payTo: mandate.merchant,
      resource: "/source/market",
      extra: {
        contract: ackrate.testnet.mandateRegistryId,
        ackrateProofVersion: 2,
        challenge,
      },
      ...requirementOverrides,
    }],
  }), { status: 402, headers: { "content-type": "application/json" } });
}

test("bound-only fetch pays once, signs the exact challenge, and retains the durable receipt", async () => {
  const events: string[] = [];
  let secondRequestObservedSavedReceipt = false;
  const receiptStore: SettlementReceiptStore = {
    async savePending() { events.push("saved"); },
    async clearPending() { events.push("cleared"); },
    async listPending() { return []; },
  };
  const { agent, mandate, signer } = makeBoundAgent(receiptStore);
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const stub = stubFetch((call) => {
    if (call === 1) return boundChallenge(mandate);
    secondRequestObservedSavedReceipt = events[0] === "saved";
    return new Response(JSON.stringify({ data: "premium" }), { status: 200 });
  });
  try {
    const response = await agent.fetch(TARGET);
    assert.equal(response.status, 200);
    assert.equal(payCalls, 1);
    assert.equal(secondRequestObservedSavedReceipt, true);
    assert.deepEqual(events, ["saved"], "transport success must not delete receipt before app acknowledgment");
    assert.equal(stub.calls.length, 2);
    for (const call of stub.calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get(ACKRATE_PAYMENT_CAPABILITIES_HEADER), BOUND_PAYMENT_CAPABILITY);
      assert.equal(call.init?.redirect, "manual");
    }
    const proofHeader = new Headers(stub.calls[1]?.init?.headers).get(X_PAYMENT_HEADER);
    assert.ok(proofHeader);
    const proof = decodePaymentProof(proofHeader);
    assert.equal(isBoundPaymentProof(proof), true);
    if (!isBoundPaymentProof(proof)) assert.fail("expected bound proof");
    assert.equal(proof.challenge.resource, "/source/market");
    assert.equal(proof.challenge.audience, "https://merchant.example");
    assert.equal(proof.mandateId, mandate.id);
    assert.equal(proof.authorization.algorithm, "stellar-ed25519-sha256");
    const receipt = getSettlementReceipt(response);
    assert.ok(receipt);
    assert.equal(receipt.proofVersion, 2);
    assert.equal(receipt.txHash, TXHASH);
    assert.deepEqual(receipt.proof, proof);
    assert.equal(receipt.mandateId, mandate.id);
    assert.equal(mandate.agent, signer.publicKey());
    await assert.rejects(() => agent.fetch(TARGET), /prior payment|reconcile/);
    await agent.acknowledgeDelivery(receipt);
    assert.deepEqual(events, ["saved", "cleared"]);
  } finally {
    stub.restore();
  }
});

test("bound-only fetch refuses legacy and 426 responses before any payment", async () => {
  for (const kind of ["legacy", "upgrade"] as const) {
    const { agent, mandate } = makeBoundAgent();
    const response = kind === "legacy"
      ? challenge402({ payTo: mandate.merchant, asset: mandate.asset })
      : new Response("upgrade", { status: 426 });
    let payCalls = 0;
    agent.pay = async () => { payCalls += 1; return TXHASH; };
    const stub = stubFetch(() => response);
    try {
      await assert.rejects(() => agent.fetch(TARGET), /bound-v2-only|capability/);
      assert.equal(payCalls, 0);
      assert.equal(stub.calls.length, 1);
    } finally {
      stub.restore();
    }
  }
});

test("bound fetch returns redirects without following or paying", async () => {
  const { agent } = makeBoundAgent();
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const stub = stubFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
  try {
    const response = await agent.fetch(TARGET);
    assert.equal(response.status, 302);
    assert.equal(payCalls, 0);
    assert.equal(stub.calls[0]?.init?.redirect, "manual");
  } finally {
    stub.restore();
  }
});

const BOUND_MISMATCHES: Array<[
  string,
  Partial<BoundPaymentChallengeV2>,
  Record<string, unknown>?,
]> = [
  ["method", { method: "HEAD" }],
  ["resource", { resource: "/source/other" }],
  ["body", { bodySha256: "1".repeat(64) }],
  ["network identity", { networkId: "2".repeat(64) }],
  ["registry", { registryId: "CDIFFERENT" }],
  ["merchant", { merchant: "GDIFFERENT" }],
  ["asset", { asset: "CDIFFERENT" }],
  ["amount", { amountStroops: "20000000" }],
  ["decimals", { decimals: 6 }],
  ["expiry", { expiresAt: 1 }],
  ["outer resource", {}, { resource: "/source/other" }],
  ["outer contract", {}, { extra: { contract: "CDIFFERENT", ackrateProofVersion: 2 } }],
];

for (const [label, challengeOverrides, requirementOverrides = {}] of BOUND_MISMATCHES) {
  test(`bound fetch rejects ${label} mismatch before paying`, async () => {
    const { agent, mandate } = makeBoundAgent();
    let payCalls = 0;
    agent.pay = async () => { payCalls += 1; return TXHASH; };
    let response: Response;
    if (label === "outer contract") {
      const original = await boundChallenge(mandate).json() as {
        accepts: Array<Record<string, unknown>>;
      };
      original.accepts[0] = { ...original.accepts[0], ...requirementOverrides };
      response = new Response(JSON.stringify(original), { status: 402 });
    } else {
      response = boundChallenge(mandate, challengeOverrides, requirementOverrides);
    }
    const stub = stubFetch(() => response);
    try {
      await assert.rejects(() => agent.fetch(TARGET), /x402:/);
      assert.equal(payCalls, 0);
      assert.equal(stub.calls.length, 1);
    } finally {
      stub.restore();
    }
  });
}

test("receipt-store failure stops before HTTP delivery and never creates a second payment", async () => {
  const receiptStore: SettlementReceiptStore = {
    async savePending() { throw new Error("encrypted store offline"); },
    async clearPending() { assert.fail("must not clear"); },
    async listPending() { return []; },
  };
  const { agent, mandate } = makeBoundAgent(receiptStore);
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const stub = stubFetch(() => boundChallenge(mandate));
  try {
    await assert.rejects(
      () => agent.fetch(TARGET),
      (error: unknown) => error instanceof DeliveryPendingError && error.receipt.proofVersion === 2,
    );
    assert.equal(payCalls, 1);
    assert.equal(stub.calls.length, 1, "delivery must wait until the receipt is durable");
  } finally {
    stub.restore();
  }
});

test("delivery recovery rejects method changes before HTTP and performs zero payments", async () => {
  const { agent, mandate } = makeBoundAgent();
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const outage = stubFetch((call) => {
    if (call === 1) return boundChallenge(mandate);
    throw new TypeError("connection refused");
  });
  let receipt;
  try {
    await agent.fetch(TARGET);
    assert.fail("expected pending delivery");
  } catch (error) {
    assert.ok(error instanceof DeliveryPendingError);
    receipt = error.receipt;
  } finally {
    outage.restore();
  }
  assert.ok(receipt);
  const retry = stubFetch(() => new Response("must not run"));
  try {
    await assert.rejects(() => agent.retryDelivery(receipt, { method: "HEAD" }), /method/);
    assert.equal(retry.calls.length, 0);
    assert.equal(payCalls, 1);
  } finally {
    retry.restore();
  }
});

test("delivery recovery rejects a retargeted receipt URL before HTTP", async () => {
  const { agent, mandate } = makeBoundAgent();
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const outage = stubFetch((call) => {
    if (call === 1) return boundChallenge(mandate);
    throw new TypeError("connection refused");
  });
  let receipt;
  try {
    await agent.fetch(TARGET);
    assert.fail("expected pending delivery");
  } catch (error) {
    assert.ok(error instanceof DeliveryPendingError);
    receipt = error.receipt;
  } finally {
    outage.restore();
  }
  assert.ok(receipt);
  const retry = stubFetch(() => new Response("must not run"));
  try {
    await assert.rejects(
      () => agent.retryDelivery({ ...receipt, url: "https://collector.example/source/market" }),
      /integrity/,
    );
    assert.equal(retry.calls.length, 0);
    assert.equal(payCalls, 1);
  } finally {
    retry.restore();
  }
});

test("bound fetch rejects a relayed genuine challenge at another origin before paying", async () => {
  const { agent, mandate } = makeBoundAgent();
  let payCalls = 0;
  agent.pay = async () => { payCalls += 1; return TXHASH; };
  const relayTarget = "https://collector.example/source/market";
  const stub = stubFetch(() => boundChallenge(mandate));
  try {
    await assert.rejects(() => agent.fetch(relayTarget), /exact request/);
    assert.equal(payCalls, 0);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("delivery recovery rejects cross-origin retargeting even with a recomputed public receipt id", async () => {
  const { agent, mandate } = makeBoundAgent();
  agent.pay = async () => TXHASH;
  const outage = stubFetch((call) => {
    if (call === 1) return boundChallenge(mandate);
    throw new TypeError("connection refused");
  });
  let receipt;
  try {
    await agent.fetch(TARGET);
    assert.fail("expected pending delivery");
  } catch (error) {
    assert.ok(error instanceof DeliveryPendingError);
    receipt = error.receipt;
  } finally {
    outage.restore();
  }
  assert.ok(receipt);
  const retargetedWithoutId = {
    proofVersion: receipt.proofVersion,
    url: "https://collector.example/source/market",
    method: receipt.method,
    txHash: receipt.txHash,
    mandateId: receipt.mandateId,
    amount: receipt.amount,
    submittedAt: receipt.submittedAt,
    validUntil: receipt.validUntil,
    proof: receipt.proof,
  };
  const retargeted = {
    receiptId: createSettlementReceiptId(retargetedWithoutId),
    ...retargetedWithoutId,
  };
  const retry = stubFetch(() => new Response("must not run"));
  try {
    await assert.rejects(() => agent.retryDelivery(retargeted), /delivery target/);
    assert.equal(retry.calls.length, 0);
  } finally {
    retry.restore();
  }
});

test("a truncated 2xx body remains delivery-pending and is never cleared", async () => {
  const events: string[] = [];
  const receiptStore: SettlementReceiptStore = {
    async savePending() { events.push("saved"); },
    async clearPending() { events.push("cleared"); },
    async listPending() { return []; },
  };
  const { agent, mandate } = makeBoundAgent(receiptStore);
  agent.pay = async () => TXHASH;
  let pulls = 0;
  const brokenBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
      } else {
        controller.error(new Error("socket reset during body"));
      }
    },
  });
  const stub = stubFetch((call) => call === 1
    ? boundChallenge(mandate)
    : new Response(brokenBody, { status: 200, headers: { "content-type": "application/json" } }));
  try {
    await assert.rejects(
      () => agent.fetch(TARGET),
      (error: unknown) => error instanceof DeliveryPendingError
        && String(error.cause).includes("socket reset during body"),
    );
    assert.deepEqual(events, ["saved"]);
  } finally {
    stub.restore();
  }
});

test("submitted-but-unconfirmed settlement survives Agent restart and blocks a second payment", async () => {
  const receiptStore = memoryReceiptStore();
  const { agent, mandate, signer } = makeBoundAgent(receiptStore);
  let payCalls = 0;
  agent.pay = (async (
    amount: string,
    lifecycle?: { onPrepared?: (settlement: {
      txHash: string;
      mandateId: string;
      amount: string;
      expectedSeq: string;
      submittedAt: number;
      validUntil: number;
    }) => string | undefined | Promise<string | undefined> },
  ) => {
    payCalls += 1;
    const submittedAt = Math.floor(Date.now() / 1_000);
    const prepared = {
      txHash: TXHASH,
      mandateId: mandate.id,
      amount,
      expectedSeq: "0",
      submittedAt,
      validUntil: submittedAt + 60,
    };
    const receiptId = await lifecycle?.onPrepared?.(prepared);
    throw new SettlementUncertainError({
      ...prepared,
      ...(receiptId ? { receiptId } : {}),
    }, new Error("RPC polling timed out after submission"));
  }) as typeof agent.pay;
  const stub = stubFetch(() => boundChallenge(mandate));
  let pending: DeliveryPendingError | undefined;
  try {
    await agent.fetch(TARGET);
    assert.fail("expected uncertain settlement");
  } catch (error) {
    assert.ok(error instanceof DeliveryPendingError);
    pending = error;
  }
  assert.ok(pending);
  assert.equal(pending.receipt.txHash, TXHASH);
  assert.equal(payCalls, 1);
  await assert.rejects(() => agent.fetch(TARGET), /prior payment|reconcile/);
  assert.equal(payCalls, 1);
  stub.restore();

  const restarted = ackrate.agent({
    mandate,
    signer,
    proofPolicy: "bound-v2-only",
    receiptStore,
  }, ackrate.testnet);
  const afterRestart = stubFetch(() => new Response("must not request or pay"));
  try {
    await assert.rejects(
      () => restarted.fetch(TARGET),
      (error: unknown) => error instanceof DeliveryPendingError
        && error.receipt.txHash === TXHASH,
    );
    assert.equal(afterRestart.calls.length, 0);
  } finally {
    afterRestart.restore();
  }
});
