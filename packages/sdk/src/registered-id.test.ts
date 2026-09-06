import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import { applyRegisteredMandateId, registeredMandateId } from "./registered-id.js";
import { Account, Keypair, Networks, rpc, scValToNative, Transaction, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { MAINNET, TESTNET } from "@ackrate/stellar";
import { ackrate } from "./index.js";

test("public core facade defaults to the official Mainnet registry without a supplied manifest", async (t) => {
  assert.equal(ackrate.mainnet, MAINNET);
  assert.equal(ackrate.testnet, TESTNET);
  const user = Keypair.random();
  const mandate = ackrate.createIntentMandate({ user: user.publicKey(), agent: user.publicKey(), merchant: user.publicKey(),
    asset: MAINNET.settlementAsset.contractId, maxAmount: "0.06", expiry: 1_800_000_000, nonce: "mainnet-default-unit-fixture" });
  assert.equal(Reflect.get(ackrate.agent({ mandate, signer: user }), "net"), MAINNET);
  assert.equal(Reflect.get(ackrate.agent({ mandate, signer: user }, TESTNET), "net"), TESTNET);
  const methods: string[] = [];
  const registeredId = Buffer.alloc(32, 12);
  t.mock.method(AssembledTransaction, "build", async (options: { contractId: string; networkPassphrase: string; rpcUrl: string; method: string }) => {
    assert.equal(options.contractId, MAINNET.mandateRegistryId);
    assert.equal(options.networkPassphrase, Networks.PUBLIC);
    assert.equal(options.rpcUrl, MAINNET.rpcUrl);
    methods.push(options.method);
    const result = { unwrap: () => options.method === "register_mandate" ? registeredId : undefined };
    return { result, signAndSend: async () => ({ result, sendTransactionResponse: { hash: "a".repeat(64) } }) };
  });
  await ackrate.registerMandate(mandate, { signer: user });
  await ackrate.revokeMandate(mandate, { signer: user });
  assert.deepEqual(methods, ["register_mandate", "revoke_mandate"]);
});

test("default budget approval authorizes only the official registry on Mainnet", async (t) => {
  const user = Keypair.random();
  const mandate = ackrate.createIntentMandate({ user: user.publicKey(), agent: user.publicKey(), merchant: user.publicKey(),
    asset: MAINNET.settlementAsset.contractId, maxAmount: "0.06", expiry: 1_800_000_000 });
  t.mock.method(rpc.Server.prototype, "getAccount", async () => new Account(user.publicKey(), "0"));
  t.mock.method(rpc.Server.prototype, "getLatestLedger", async () => ({ sequence: 64_500_000 }));
  t.mock.method(rpc.Server.prototype, "prepareTransaction", async (tx: Transaction) => tx);
  let submitted = false;
  t.mock.method(rpc.Server.prototype, "sendTransaction", async (tx: Transaction) => {
    assert.equal(tx.networkPassphrase, Networks.PUBLIC);
    const operation = tx.operations[0];
    assert.equal(operation.type, "invokeHostFunction");
    if (operation.type !== "invokeHostFunction") throw new Error("expected token invocation");
    const invoke = operation.func.invokeContract();
    assert.equal(invoke.functionName().toString(), "approve");
    assert.equal(scValToNative(xdr.ScVal.scvAddress(invoke.contractAddress())), MAINNET.settlementAsset.contractId);
    assert.deepEqual(invoke.args().slice(0, 3).map((arg) => scValToNative(arg)), [user.publicKey(), MAINNET.mandateRegistryId, 600_000n]);
    assert.equal(tx.signatures.length, 1);
    submitted = true;
    return { status: "PENDING", hash: "b".repeat(64) };
  });
  t.mock.method(rpc.Server.prototype, "getTransaction", async () => ({ status: "SUCCESS" }));
  assert.equal(await ackrate.approveBudget(mandate, { signer: user }), "b".repeat(64));
  assert.equal(submitted, true);
});

test("V2 registration retains its returned storage id and original credential hash", () => {
  const credential = Buffer.alloc(32, 1);
  const returned = Buffer.alloc(32, 2);
  const mandate = { id: credential.toString("hex"), idBuffer: credential, credentialHash: undefined as string | undefined };
  applyRegisteredMandateId(mandate, registeredMandateId(returned), returned);
  assert.equal(mandate.id, returned.toString("hex"));
  assert.deepEqual(mandate.idBuffer, returned);
  assert.equal(mandate.credentialHash, credential.toString("hex"));
  returned.fill(3);
  assert.equal(mandate.idBuffer[0], 2, "returned buffers must not alias the retained identifier");
});

test("legacy registration preserves the original equal storage identifier", () => {
  const id = Buffer.alloc(32, 4);
  const mandate = { id: id.toString("hex"), idBuffer: id };
  applyRegisteredMandateId(mandate, id, id);
  assert.equal(mandate.id, id.toString("hex"));
});

test("malformed or inconsistent registration return does not change mandate identity", () => {
  for (const value of [undefined, null, "a".repeat(64), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => registeredMandateId(value), /invalid mandate identifier/);
  }
  const id = Buffer.alloc(32, 1);
  const mandate = { id: id.toString("hex"), idBuffer: id };
  assert.throws(() => applyRegisteredMandateId(mandate, Buffer.alloc(32, 2), Buffer.alloc(32, 3)), /different identifiers/);
  assert.equal(mandate.id, id.toString("hex"));
  assert.equal(mandate.idBuffer, id);
});
