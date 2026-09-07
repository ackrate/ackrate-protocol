import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Contract, Keypair, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { MAINNET, TESTNET, keypairSigner, registryClient, type Mandate } from "@ackrate/stellar";
import { recoverSetupRegistration, type SetupResumeReads } from "./setup-resume.js";

const NOW = 1_900_000_000;
const SEQUENCE = "276048389543428097";
function payerEntry(address: string, sequence = SEQUENCE) {
  return new xdr.AccountEntry({ accountId: Keypair.fromPublicKey(address).xdrAccountId(),
    balance: xdr.Int64.fromString("19000000"), seqNum: xdr.Int64.fromString(sequence), numSubEntries: 1,
    inflationDest: null, flags: 0, homeDomain: "", thresholds: Buffer.from([1, 0, 0, 0]), signers: [], ext: new xdr.AccountEntryExt(0) });
}
function fixture() {
  const user = Keypair.random(); const signer = keypairSigner(user, MAINNET.networkPassphrase);
  const scope = { user: user.publicKey(), agent: Keypair.random().publicKey(), merchant: Keypair.random().publicKey(),
    asset: MAINNET.settlementAsset.contractId, maxAmount: 300_000n, decimals: 7 };
  const id = Buffer.alloc(32, 2); const credential = Buffer.alloc(32, 3);
  const client = registryClient(MAINNET, signer);
  const args = { user: scope.user, agent: scope.agent, merchant: scope.merchant, asset: scope.asset,
    max_amount: scope.maxAmount, expiry: BigInt(NOW + 1200), vc_hash: credential };
  const makeTx = (patch: Partial<typeof args> = {}, contract = MAINNET.mandateRegistryId, source = scope.user) =>
    new TransactionBuilder(new Account(source, (BigInt(SEQUENCE) - 1n).toString()), { fee: "100", networkPassphrase: MAINNET.networkPassphrase })
      .addOperation(new Contract(contract).call("register_mandate", ...client.spec.funcArgsToScVals("register_mandate", { ...args, ...patch })))
      .setTimebounds(NOW - 100, NOW + 500).build();
  const tx = makeTx();
  let found: Record<string, unknown> = { status: "SUCCESS", txHash: tx.hash().toString("hex"), feeBump: false,
    ledger: 1000, latestLedger: 1020, latestLedgerCloseTime: NOW - 5, envelopeXdr: tx.toEnvelope(), returnValue: xdr.ScVal.scvBytes(id) };
  let chain: Mandate = { ...args, seq: 0, spent: 0n, status: { tag: "Active", values: undefined } };
  let payer = payerEntry(scope.user);
  let network: unknown = { passphrase: MAINNET.networkPassphrase };
  const calls: string[] = [];
  const reads: SetupResumeReads = {
    async getNetwork() { calls.push("network"); return network; },
    async getTransaction(hash) { calls.push("transaction"); assert.equal(hash, found.txHash); return found; },
    async getPayerAccount() { calls.push("payer"); return payer; },
    async getMandate(mandateId) { calls.push("mandate"); assert.deepEqual(mandateId, id); return chain; },
  };
  return { scope, signer, id, credential, tx, makeTx, reads, calls,
    hash: () => String(found.txHash),
    setFound: (patch: Record<string, unknown>) => { found = { ...found, ...patch }; },
    setChain: (patch: Partial<Mandate>) => { chain = { ...chain, ...patch }; },
    setPayer: (value: xdr.AccountEntry) => { payer = value; },
    setNetwork: (value: unknown) => { network = value; } };
}

test("setup resume reconstructs only exact returned ID and original credential from an untouched confirmed registration", async () => {
  const f = fixture();
  const mandate = await recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW);
  assert.deepEqual(mandate, { ...f.scope, id: f.id.toString("hex"), idBuffer: f.id,
    credentialHash: f.credential.toString("hex"), expiry: NOW + 1200 });
  assert.deepEqual(f.calls, ["network", "transaction", "payer", "mandate"]);
});

test("actual RPC decimal-string close time is accepted but noncanonical and unsafe timestamps fail closed", async () => {
  const f = fixture(); f.setFound({ latestLedgerCloseTime: String(NOW - 5) });
  assert.equal((await recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW)).id, f.id.toString("hex"));
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "01900000000", "9007199254740992", " 1900000000", "1900000000 "]) {
    const invalid = fixture(); invalid.setFound({ latestLedgerCloseTime: value });
    await assert.rejects(recoverSetupRegistration(invalid.hash(), invalid.scope, MAINNET, invalid.signer, invalid.reads, NOW));
    assert.equal(invalid.calls.includes("payer"), false);
  }
});

test("setup resume rejects malformed hash, wrong network configuration, asset and signer before RPC", async () => {
  const f = fixture();
  await assert.rejects(recoverSetupRegistration("not-a-hash", f.scope, MAINNET, f.signer, f.reads, NOW));
  await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, TESTNET, f.signer, f.reads, NOW));
  await assert.rejects(recoverSetupRegistration(f.hash(), { ...f.scope, asset: TESTNET.nativeSac }, MAINNET, f.signer, f.reads, NOW));
  await assert.rejects(recoverSetupRegistration(f.hash(), { ...f.scope, user: f.scope.agent }, MAINNET, f.signer, f.reads, NOW));
  assert.deepEqual(f.calls, []);
});

test("setup resume rejects wrong/error RPC identity before fetching registration", async () => {
  for (const value of [{}, { passphrase: TESTNET.networkPassphrase }, { passphrase: MAINNET.networkPassphrase, error: {} }]) {
    const f = fixture(); f.setNetwork(value);
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW));
    assert.deepEqual(f.calls, ["network"]);
  }
});

test("missing, failed, fee-bumped, malformed, stale and wrong-hash registration evidence fails closed", async () => {
  for (const patch of [{ status: "NOT_FOUND" }, { status: "FAILED" }, { feeBump: true }, { envelopeXdr: "bad" },
    { txHash: "a".repeat(64) }, { returnValue: undefined }, { returnValue: xdr.ScVal.scvBytes(Buffer.alloc(31)) },
    { latestLedgerCloseTime: NOW - 121 }, { latestLedgerCloseTime: NOW + 1 }, { latestLedger: 999 },
    { ledger: NaN }, { latestLedger: Infinity }, { ledger: 0x1_0000_0000 }, { latestLedger: 0x1_0000_0000 }]) {
    const f = fixture(); f.setFound(patch);
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW));
    assert.equal(f.calls.includes("payer"), false);
  }
});

test("resume rejects extra operations and non-registration invocations even for their exact hashes", async () => {
  for (const extra of [true, false]) {
    const f = fixture();
    const operation = extra ? f.tx.operations[0]! : undefined;
    const builder = new TransactionBuilder(new Account(f.scope.user, (BigInt(SEQUENCE) - 1n).toString()),
      { fee: "100", networkPassphrase: MAINNET.networkPassphrase });
    if (extra && operation?.type === "invokeHostFunction") {
      builder.addOperation(new Contract(MAINNET.mandateRegistryId).call("register_mandate", ...operation.func.invokeContract().args()));
    }
    const tx = builder.addOperation(new Contract(MAINNET.mandateRegistryId).call("is_paused")).setTimeout(600).build();
    f.setFound({ txHash: tx.hash().toString("hex"), envelopeXdr: tx.toEnvelope() });
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW), /transaction, policy/);
    assert.equal(f.calls.includes("payer"), false);
  }
});

test("even matching transaction hashes cannot substitute registration scope, contract, source, budget or expiry", async () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => ReturnType<ReturnType<typeof fixture>["makeTx"]>> = [
    (f) => f.makeTx({ user: f.scope.agent }), (f) => f.makeTx({ agent: f.scope.merchant }),
    (f) => f.makeTx({ merchant: f.scope.agent }), (f) => f.makeTx({ asset: TESTNET.nativeSac }),
    (f) => f.makeTx({ max_amount: 300_001n }), (f) => f.makeTx({ expiry: BigInt(NOW) }),
    (f) => f.makeTx({}, TESTNET.mandateRegistryId), (f) => f.makeTx({}, MAINNET.mandateRegistryId, f.scope.agent),
  ];
  for (const change of mutations) {
    const f = fixture(); const tx = change(f); f.setFound({ txHash: tx.hash().toString("hex"), envelopeXdr: tx.toEnvelope() });
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW), /transaction, policy/);
    assert.equal(f.calls.includes("payer"), false);
  }
});

test("used, revoked, expired, wrong-credential and altered on-chain policy cannot resume", async () => {
  const patches: Partial<Mandate>[] = [];
  patches.push({ seq: 1 }, { spent: 1n }, { status: { tag: "Revoked", values: undefined } },
    { expiry: BigInt(NOW - 1) }, { max_amount: 400_000n }, { vc_hash: Buffer.alloc(32, 9) },
    { user: Keypair.random().publicKey() }, { agent: Keypair.random().publicKey() },
    { merchant: Keypair.random().publicKey() }, { asset: TESTNET.nativeSac });
  for (const patch of patches) {
    const f = fixture(); f.setChain(patch);
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW), /used, revoked/);
  }
});

test("payer sequence must still equal registration sequence, not an already signed or used allowance", async () => {
  for (const sequence of [(BigInt(SEQUENCE) + 1n).toString(), (BigInt(SEQUENCE) - 1n).toString()]) {
    const f = fixture(); f.setPayer(payerEntry(f.scope.user, sequence));
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW), /payer sequence changed/);
  }
  const f = fixture(); f.setPayer(payerEntry(f.scope.agent));
  await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW), /payer sequence changed/);
});

test("an unavailable on-chain read never becomes permission to register or sign", async () => {
  for (const method of ["getNetwork", "getTransaction", "getPayerAccount", "getMandate"] as const) {
    const f = fixture(); f.reads[method] = async () => { throw new Error("synthetic read failure"); };
    await assert.rejects(recoverSetupRegistration(f.hash(), f.scope, MAINNET, f.signer, f.reads, NOW));
  }
});
