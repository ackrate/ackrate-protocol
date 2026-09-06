import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Account, Address, Keypair, Networks, StrKey, Transaction, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./config.js";
import { authorized } from "./token.js";

const account = Keypair.random().publicKey();
const asset = StrKey.encodeContract(Buffer.alloc(32, 7));
const net: NetworkConfig = {
  rpcUrl: "https://rpc.example.invalid",
  networkPassphrase: Networks.PUBLIC,
  mandateRegistryId: StrKey.encodeContract(Buffer.alloc(32, 8)),
  nativeSac: StrKey.encodeContract(Buffer.alloc(32, 9)),
};

function mockRead(t: TestContext, response: unknown) {
  const operations: Transaction[] = [];
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network access"); });
  t.mock.method(rpc.Server.prototype, "getAccount", async (who: string) => {
    assert.equal(who, account);
    return new Account(account, "123");
  });
  t.mock.method(rpc.Server.prototype, "simulateTransaction", async (tx: Transaction) => {
    operations.push(tx);
    return response;
  });
  for (const name of ["prepareTransaction", "sendTransaction", "getTransaction"] as const) {
    t.mock.method(rpc.Server.prototype, name, async () => { throw new Error(`read-only authorization must not call ${name}`); });
  }
  return operations;
}

const simulation = (retval: xdr.ScVal) => ({ transactionData: {}, result: { retval } });

test("SAC authorization reads only the exact account and asset through an unsigned simulation", async (t) => {
  const operations = mockRead(t, simulation(xdr.ScVal.scvBool(true)));
  assert.equal(await authorized(net, asset, account), true);
  assert.equal(operations.length, 1);
  const transaction = operations[0]!;
  assert.equal(transaction.source, account);
  assert.equal(transaction.networkPassphrase, Networks.PUBLIC);
  assert.equal(transaction.signatures.length, 0);
  assert.equal(transaction.operations.length, 1);
  const operation = transaction.operations[0]!;
  assert.equal(operation.type, "invokeHostFunction");
  if (operation.type !== "invokeHostFunction") throw new Error("expected contract read");
  const invocation = operation.func.invokeContract();
  assert.equal(Address.fromScAddress(invocation.contractAddress()).toString(), asset);
  assert.equal(invocation.functionName().toString(), "authorized");
  assert.equal(invocation.args().length, 1);
  assert.equal(Address.fromScVal(invocation.args()[0]!).toString(), account);
});

test("SAC authorization returns false for deauthorized or maintain-liabilities-only accounts", async (t) => {
  mockRead(t, simulation(xdr.ScVal.scvBool(false)));
  assert.equal(await authorized(net, asset, account), false);
});

test("SAC authorization rejects missing or non-boolean return values rather than treating them as approval", async (t) => {
  for (const response of [
    {}, { transactionData: {} },
    simulation(nativeToScVal(1, { type: "u32" })),
    simulation(nativeToScVal("true")),
    simulation(xdr.ScVal.scvVoid()),
  ]) {
    t.mock.restoreAll();
    mockRead(t, response);
    await assert.rejects(authorized(net, asset, account), /authorization response is invalid/);
  }
});

test("SAC authorization does not convert missing trustlines or RPC failures into success", async (t) => {
  mockRead(t, { error: "TrustlineMissingError" });
  await assert.rejects(authorized(net, asset, account), /authorization sim failed: TrustlineMissingError/);
  t.mock.method(rpc.Server.prototype, "simulateTransaction", async () => { throw new Error("RPC unavailable"); });
  await assert.rejects(authorized(net, asset, account), /RPC unavailable/);
});
