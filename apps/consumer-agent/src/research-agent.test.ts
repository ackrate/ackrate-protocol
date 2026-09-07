import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createSettlementReceiptId,
  DeliveryPendingError,
  ackrate,
  type SettlementReceipt,
} from "@ackrate/core";
import {
  acknowledgePendingDelivery,
  blockReason,
  buyResearch,
  resumePendingDelivery,
} from "./research-agent.js";
import type {
  PurchaseOutcomeStore,
  StoredPurchaseOutcome,
} from "./outcome-store.js";

const emptyReceiptStore = {
  async savePending() {},
  async clearPending() {},
  async listPending() { return []; },
};

function memoryOutcomeStore(): PurchaseOutcomeStore {
  const records = new Map<string, { executionId: string; outcome?: StoredPurchaseOutcome }>();
  return {
    async lookup(identity) {
      const record = records.get(identity.key);
      if (!record) return { kind: "missing" };
      return record.outcome
        ? { kind: "completed", outcome: record.outcome }
        : { kind: "executing", executionId: record.executionId };
    },
    async claim(identity, executionId) {
      const record = records.get(identity.key);
      if (record?.outcome) return { kind: "completed", outcome: record.outcome };
      if (record) return { kind: "executing", executionId: record.executionId };
      records.set(identity.key, { executionId });
      return { kind: "claimed" };
    },
    async complete(identity, executionId, outcome) {
      const record = records.get(identity.key);
      if (!record || record.executionId !== executionId) throw new Error("wrong execution");
      if (record.outcome && record.outcome.outcomeId !== outcome.outcomeId) throw new Error("conflict");
      record.outcome = outcome;
      return outcome;
    },
  };
}

test("blockReason maps terminal contract rejections without calling them retryable", () => {
  assert.equal(blockReason("Error(Contract, #4)"), "mandate expired");
  assert.equal(blockReason("Error(Contract, #5)"), "mandate revoked");
  assert.equal(blockReason("Error(Contract, #6)"), "budget exceeded");
  assert.equal(blockReason("Error(Contract, #7)"), "merchant out of scope");
  assert.equal(blockReason("other"), "rejected on-chain");
});

test("consumer surfaces settled-but-undelivered payment and never retries blindly", async () => {
  const key = Keypair.random();
  const mandate = ackrate.createIntentMandate({
    user: key.publicKey(),
    agent: key.publicKey(),
    merchant: key.publicKey(),
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    maxAmount: "1.00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  const receipt: SettlementReceipt = {
    receiptId: "c".repeat(64),
    proofVersion: 1,
    url: "http://merchant.test/source/market",
    method: "GET",
    txHash: "a".repeat(64),
    mandateId: mandate.id,
    amount: "1.00",
    submittedAt: 1_700_000_000,
    validUntil: 1_700_000_060,
    proof: {
      scheme: "ackrate-soroban",
      network: "stellar-testnet",
      txHash: "a".repeat(64),
      mandateId: mandate.id,
      amount: "1.00",
    },
  };
  const originalAgent = ackrate.agent;
  let fetchCalls = 0;
  ackrate.agent = (() => ({
    fetch: async () => {
      fetchCalls += 1;
      throw new DeliveryPendingError(receipt, new TypeError("connection refused"));
    },
  })) as unknown as typeof ackrate.agent;
  try {
    const result = await buyResearch({
      serverUrl: "http://merchant.test",
      sourceIds: ["market"],
      mandate,
      agentSecret: key.secret(),
      receiptStore: emptyReceiptStore,
      outcomeStore: memoryOutcomeStore(),
    });
    assert.equal(fetchCalls, 1);
    assert.equal(result[0]?.ok, false);
    assert.equal(result[0]?.deliveryState, "pending");
    assert.equal(result[0]?.txHash, receipt.txHash);
    assert.deepEqual(result[0]?.receipt, receipt);
    assert.match(result[0]?.blockedReason ?? "", /do not pay again/);
  } finally {
    ackrate.agent = originalAgent;
  }
});

test("durable application outcome survives an acknowledgment crash and restart never fetches again", async () => {
  const key = Keypair.random();
  const mandate = ackrate.createIntentMandate({
    user: key.publicKey(),
    agent: key.publicKey(),
    merchant: key.publicKey(),
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    maxAmount: "1.00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    nonce: "application-outcome-crash-test",
  });
  const proof = {
    scheme: "ackrate-soroban",
    network: "stellar-testnet",
    txHash: "a".repeat(64),
    mandateId: mandate.id,
    amount: "1.00",
  };
  const receiptWithoutId = {
    proofVersion: 1 as const,
    url: "http://merchant.test/source/market",
    method: "GET",
    txHash: proof.txHash,
    mandateId: mandate.id,
    amount: proof.amount,
    submittedAt: 1_700_000_000,
    validUntil: 1_700_000_060,
    proof,
  };
  const receipt: SettlementReceipt = {
    receiptId: createSettlementReceiptId(receiptWithoutId),
    ...receiptWithoutId,
  };
  const pending = new Map([[receipt.receiptId, receipt]]);
  const receiptStore = {
    async savePending(candidate: Readonly<SettlementReceipt>) { pending.set(candidate.receiptId, candidate); },
    async clearPending(receiptId: string) { pending.delete(receiptId); },
    async listPending() { return [...pending.values()]; },
  };
  const outcomeStore = memoryOutcomeStore();
  const originalAgent = ackrate.agent;
  const originalFetch = globalThis.fetch;
  const actualAgent = originalAgent({ mandate, signer: key.secret(), receiptStore });
  let fetchCalls = 0;
  let failAcknowledgment = true;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    name: "Market",
    data: "accepted",
    settledTx: receipt.txHash,
  }), { status: 200, headers: { "content-type": "application/json" } });
  ackrate.agent = (() => ({
    fetch: async () => {
      fetchCalls += 1;
      return actualAgent.retryDelivery(receipt);
    },
    acknowledgeDelivery: async (candidate: Readonly<SettlementReceipt>) => {
      if (failAcknowledgment) {
        failAcknowledgment = false;
        throw new DeliveryPendingError(candidate, new Error("simulated crash before receipt clear"));
      }
      await actualAgent.acknowledgeDelivery(candidate);
    },
  })) as unknown as typeof ackrate.agent;
  try {
    const first = await buyResearch({
      serverUrl: "http://merchant.test",
      sourceIds: ["market"],
      mandate,
      agentSecret: key.secret(),
      receiptStore,
      outcomeStore,
    });
    assert.equal(first[0]?.deliveryState, "pending");
    assert.equal(fetchCalls, 1);
    assert.equal(pending.size, 1);

    const restarted = await buyResearch({
      serverUrl: "http://merchant.test",
      sourceIds: ["market"],
      mandate,
      agentSecret: key.secret(),
      receiptStore,
      outcomeStore,
    });
    assert.equal(restarted[0]?.deliveryState, "delivered");
    assert.equal(restarted[0]?.data, "accepted");
    assert.equal(fetchCalls, 1);
    assert.equal(pending.size, 0);
  } finally {
    ackrate.agent = originalAgent;
    globalThis.fetch = originalFetch;
  }
});

test("real recovery helpers share the exact receipt lock and acknowledgment releases it", async () => {
  const publicKey = Keypair.random().publicKey();
  let signs = 0;
  const signer = {
    publicKey,
    signTransaction: async (): Promise<never> => {
      signs += 1;
      throw new Error("recovery must never sign");
    },
  };
  const mandate = ackrate.createIntentMandate({
    user: publicKey,
    agent: publicKey,
    merchant: publicKey,
    asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    maxAmount: "1.00",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  });
  const proof = {
    scheme: "ackrate-soroban",
    network: "stellar-testnet",
    txHash: "a".repeat(64),
    mandateId: mandate.id,
    amount: "1.00",
  };
  const receiptWithoutId = {
    proofVersion: 1 as const,
    url: "http://merchant.test/source/market",
    method: "GET",
    txHash: proof.txHash,
    mandateId: mandate.id,
    amount: proof.amount,
    submittedAt: 1_700_000_000,
    validUntil: 1_700_000_060,
    proof,
  };
  const receipt: SettlementReceipt = {
    ...receiptWithoutId,
    receiptId: createSettlementReceiptId(receiptWithoutId),
  };
  const pending = new Map([[receipt.receiptId, receipt]]);
  const receiptStore = {
    async savePending(candidate: Readonly<SettlementReceipt>) { pending.set(candidate.receiptId, candidate); },
    async clearPending(receiptId: string) { pending.delete(receiptId); },
    async listPending() { return [...pending.values()]; },
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response("recovered", { status: 200 });
  };
  const original = ackrate.agent({ mandate, signer, receiptStore }, ackrate.testnet);
  const opts = { mandate, agentSigner: signer, networkConfig: ackrate.testnet, receipt, receiptStore };
  try {
    await assert.rejects(() => original.fetch(receipt.url), DeliveryPendingError);
    const response = await resumePendingDelivery(opts);
    assert.equal(response.status, 200);
    assert.equal(pending.size, 1);
    await acknowledgePendingDelivery(opts);
    assert.equal(pending.size, 0);
    assert.equal(original.getPendingSettlement(), undefined);
    assert.equal((await original.fetch(receipt.url)).status, 200);
    // A new helper-created Agent can acquire a later operation after the first
    // helper's now-unreachable Agent has been acknowledged.
    assert.equal((await resumePendingDelivery(opts)).status, 200);
    await acknowledgePendingDelivery(opts);
    assert.equal(requests, 3);
    assert.equal(signs, 0);
  } finally {
    await acknowledgePendingDelivery(opts);
    globalThis.fetch = originalFetch;
  }
});
