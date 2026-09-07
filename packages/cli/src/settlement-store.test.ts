import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { TESTNET } from "@ackrate/stellar";
import { createSettlementReceiptId, type PendingSettlement, type SettlementReceipt } from "@ackrate/core";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import {
  acknowledgeCompletedSettlement,
  assertNoPendingSettlement,
  claimDemoRun,
  claimPendingSettlement,
  classifyMissingSettlement,
  clearPendingSettlement,
  completeDemoRun,
  demoRecoveryDirectory,
  findUnresolvedDemoEvidence,
  loadPendingSettlement,
  markSettlementCompleted,
  settlementDirectory,
  updateDemoRun,
  type DemoRunContext,
} from "./settlement-store.js";
import { FileSettlementReceiptStore } from "../../../apps/consumer-agent/src/receipt-store.js";
import { FilePurchaseOutcomeStore, createPurchaseIdentity, createStoredPurchaseOutcome } from "../../../apps/consumer-agent/src/outcome-store.js";
import { runSettlementReconcile } from "./commands/reconcile.js";
import { runDemo } from "./commands/demo.js";

const roots: string[] = [];
const previousHome = process.env.ACKRATE_HOME;
const previousExitCode = process.exitCode;

afterEach(async () => {
  if (previousHome === undefined) delete process.env.ACKRATE_HOME;
  else process.env.ACKRATE_HOME = previousHome;
  process.exitCode = previousExitCode;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ackrate-cli-settlement-"));
  roots.push(root);
  process.env.ACKRATE_HOME = root;
  return root;
}

function pending(digit = "a"): PendingSettlement {
  return {
    txHash: digit.repeat(64),
    mandateId: "b".repeat(64),
    amount: "1.00",
    expectedSeq: "0",
    submittedAt: 1_700_000_000,
    validUntil: 1_700_000_060,
  };
}

test("two concurrent prepared payments produce exactly one durable cross-process claim", async () => {
  await home();
  const results = await Promise.allSettled([
    claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending("a")),
    claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending("c")),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const loaded = await loadPendingSettlement();
  assert.equal(loaded.kind, "pending");
  if (loaded.kind !== "pending") assert.fail("expected pending journal");
  assert.ok(["a".repeat(64), "c".repeat(64)].includes(loaded.record.pending.txHash));
  assert.equal((await stat(settlementDirectory())).mode & 0o777, 0o700);
  assert.equal((await stat(join(settlementDirectory(), "state.json"))).mode & 0o777, 0o600);
});

test("payment claim fsyncs its parent before authorizing broadcast and aborts on parent-sync failure", async () => {
  for (const failSync of [false, true]) {
    const root = await home();
    const originalOpen = fsPromises.open;
    let parentSyncs = 0;
    fsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === root && args[1] === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          parentSyncs += 1;
          if (failSync) throw new Error("simulated parent fsync failure");
          await sync();
        };
      }
      return handle;
    }) as typeof fsPromises.open;
    syncBuiltinESMExports();
    try {
      const claim = claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending());
      if (failSync) await assert.rejects(claim, /simulated parent fsync failure/);
      else await claim;
    } finally {
      fsPromises.open = originalOpen;
      syncBuiltinESMExports();
    }
    assert.equal(parentSyncs, 1);
    assert.equal((await loadPendingSettlement()).kind, failSync ? "none" : "pending");
  }
});

test("two separate CLI processes cannot both acquire the payment journal", async () => {
  const root = await home();
  const moduleUrl = new URL("./settlement-store.ts", import.meta.url).href;
  const code = `
    import { claimPendingSettlement } from ${JSON.stringify(moduleUrl)};
    const pending = JSON.parse(process.env.ACKRATE_TEST_PENDING);
    await claimPendingSettlement("pay", ${JSON.stringify(TESTNET.mandateRegistryId)}, pending);
  `;
  const run = (value: PendingSettlement) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
      env: {
        ...process.env,
        ACKRATE_HOME: root,
        ACKRATE_TEST_PENDING: JSON.stringify(value),
      },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", resolve);
  });
  const statuses = await Promise.all([run(pending("a")), run(pending("c"))]);
  assert.deepEqual(statuses.sort(), [0, 1]);
});

test("hash-specific clear cannot delete another payment", async () => {
  await home();
  await claimPendingSettlement("demo", TESTNET.mandateRegistryId, pending());
  await assert.rejects(() => clearPendingSettlement("c".repeat(64)), /different pending/);
  assert.equal((await loadPendingSettlement()).kind, "pending");
  await clearPendingSettlement("a".repeat(64));
  assert.equal((await loadPendingSettlement()).kind, "none");
});

test("successful settlement remains locked across restart until exact acknowledgment", async () => {
  await home();
  const hash = "a".repeat(64);
  await claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending());
  await markSettlementCompleted(hash);

  const loaded = await loadPendingSettlement();
  assert.equal(loaded.kind, "completed");
  if (loaded.kind !== "completed") assert.fail("expected completed journal");
  assert.equal(loaded.record.pending.txHash, hash);
  await assert.rejects(() => assertNoPendingSettlement(), /unresolved or unacknowledged/);
  await assert.rejects(() => clearPendingSettlement(hash), /explicit acknowledgment/);
  await assert.rejects(() => acknowledgeCompletedSettlement("c".repeat(64)), /different completed/);
  assert.equal((await loadPendingSettlement()).kind, "completed");

  await acknowledgeCompletedSettlement(hash);
  assert.equal((await loadPendingSettlement()).kind, "none");
  await assert.doesNotReject(() => assertNoPendingSettlement());
});

test("mainnet journal pins the public network and exact credential-free RPC", async () => {
  await home();
  const user = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
  const agent = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
  const merchant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
  await claimPendingSettlement("demo", TESTNET.mandateRegistryId, pending(), {
    network: "mainnet",
    rpcUrl: "https://rpc.mainnet.example",
    assetId: TESTNET.nativeSac,
    user,
    agent,
    merchant,
  });
  const loaded = await loadPendingSettlement();
  assert.equal(loaded.kind, "pending");
  if (loaded.kind !== "pending") assert.fail("expected pending journal");
  assert.equal(loaded.record.version, 4);
  assert.equal(loaded.record.network, "mainnet");
  assert.equal(loaded.record.rpcUrl, "https://rpc.mainnet.example");
  assert.deepEqual(
    [loaded.record.assetId, loaded.record.user, loaded.record.agent, loaded.record.merchant],
    [TESTNET.nativeSac, user, agent, merchant],
  );
});

test("mainnet journal rejects incomplete actor or asset identity", async () => {
  await home();
  await assert.rejects(
    claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending(), {
      network: "mainnet",
      rpcUrl: "https://rpc.mainnet.example",
    }),
    /schema/,
  );
});

test("legacy testnet v2 journal remains recoverable", async () => {
  await home();
  await mkdir(settlementDirectory(), { mode: 0o700 });
  await writeFile(join(settlementDirectory(), "state.json"), `${JSON.stringify({
    version: 2,
    state: "pending",
    source: "pay",
    network: "testnet",
    contractId: TESTNET.mandateRegistryId,
    pending: pending(),
  })}\n`, { mode: 0o600 });
  const loaded = await loadPendingSettlement();
  assert.equal(loaded.kind, "pending");
  if (loaded.kind !== "pending") assert.fail("expected pending journal");
  assert.equal(loaded.record.rpcUrl, TESTNET.rpcUrl);
});

test("completed transition is idempotent for only the exact transaction hash", async () => {
  await home();
  await claimPendingSettlement("demo", TESTNET.mandateRegistryId, pending());
  await markSettlementCompleted("a".repeat(64));
  await assert.doesNotReject(() => markSettlementCompleted("a".repeat(64)));
  await assert.rejects(() => markSettlementCompleted("c".repeat(64)), /different settlement/);
  assert.equal((await loadPendingSettlement()).kind, "completed");
});

test("an empty claim stays locked because its owner may still be preparing metadata", async () => {
  await home();
  await mkdir(settlementDirectory(), { mode: 0o700 });
  assert.equal((await loadPendingSettlement()).kind, "empty");
  await assert.rejects(() => clearPendingSettlement("a".repeat(64)), /empty journal claim/);
  await assert.rejects(() => clearPendingSettlement(), /empty journal claim/);
  await runSettlementReconcile();
  assert.equal(process.exitCode, 1);
  assert.equal((await loadPendingSettlement()).kind, "empty");
});

const DEMO_CONTEXT: DemoRunContext = {
  network: "mainnet",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  contractId: "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR",
  assetId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  user: "GCFH7H3OTPKXLWZFDMPOGUVI4QRIYHX2G5EDRBGAXKTIARBYGDAW4IKN",
  agent: "GBALWVF5IYJUW6NBQE7UIOM2JRZIFMMS7OXFDWSYRHU2GUPS3OUM5ZSZ",
  merchant: "GBE3PH4ZYVYUXZWZL4YJP22H5J46U6VQVF6SYNJ3GGU3RHBN4M77VNBG",
};
const DEMO_MANDATE = "b".repeat(64);
const DEMO_ORIGIN = "http://127.0.0.1:8402";

function demoReceipt(): SettlementReceipt {
  // Unsigned historical-shape fixture exercises storage containment only.
  const proof = { scheme: "ackrate-soroban", network: "stellar-mainnet", txHash: "a".repeat(64), mandateId: DEMO_MANDATE, amount: "0.01" };
  const receipt = {
    proofVersion: 1, url: `${DEMO_ORIGIN}/source/market`, method: "GET",
    txHash: proof.txHash, mandateId: proof.mandateId, amount: proof.amount,
    submittedAt: 1_700_000_000, validUntil: 1_700_000_060, proof,
  };
  return { ...receipt, receiptId: createSettlementReceiptId(receipt) };
}

async function acceptedDemoOutcomes(): Promise<void> {
  const store = new FilePurchaseOutcomeStore(join(demoRecoveryDirectory(DEMO_MANDATE), "outcomes.json"));
  for (const [index, sourceId] of ["market", "academic", "news", "patents"].entries()) {
    const identity = createPurchaseIdentity({ mandateId: DEMO_MANDATE, url: `${DEMO_ORIGIN}/source/${sourceId}`, sourceId });
    const executionId = randomUUID();
    await store.claim(identity, executionId, 1_700_000_000);
    const outcome = sourceId === "patents"
      ? createStoredPurchaseOutcome({ identity, kind: "rejected", reason: "budget exceeded" })
      : createStoredPurchaseOutcome({ identity, kind: "delivered", receiptId: "c".repeat(64), txHash: String(index + 1).repeat(64), name: sourceId, data: "synthetic accepted output" });
    await store.complete(identity, executionId, outcome);
  }
}

function isolatedProcess(root: string, code: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
      env: { PATH: process.env.PATH ?? "", ACKRATE_HOME: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("a demo claim survives process exit and a fresh process cannot replace or payment-acknowledge it", async () => {
  const root = await home();
  const moduleUrl = new URL("./settlement-store.ts", import.meta.url).href;
  const first = await isolatedProcess(root, `
    import { claimDemoRun } from ${JSON.stringify(moduleUrl)};
    await claimDemoRun(${JSON.stringify(DEMO_CONTEXT)});
    process.exit(23);
  `);
  assert.equal(first.status, 23, first.stderr);
  const second = await isolatedProcess(root, `
    import assert from "node:assert/strict";
    import { loadPendingSettlement, assertNoPendingSettlement, clearPendingSettlement, markSettlementCompleted, acknowledgeCompletedSettlement, completeDemoRun } from ${JSON.stringify(moduleUrl)};
    import { runDemo } from ${JSON.stringify(new URL("./commands/demo.ts", import.meta.url).href)};
    import { runSettlementReconcile } from ${JSON.stringify(new URL("./commands/reconcile.ts", import.meta.url).href)};
    globalThis.fetch = async () => { throw new Error("network forbidden in restart test"); };
    const loaded = await loadPendingSettlement();
    assert.equal(loaded.kind, "demo-run");
    await assert.rejects(() => assertNoPendingSettlement(), /manual exact-receipt recovery/);
    await assert.rejects(() => runDemo("research-agent", { network: "mainnet" }), /manual exact-receipt recovery/);
    await assert.rejects(() => clearPendingSettlement(), /payment-only operation/);
    await assert.rejects(() => markSettlementCompleted("a".repeat(64)), /cannot be completed by payment reconciliation/);
    await assert.rejects(() => acknowledgeCompletedSettlement("a".repeat(64)), /no completed payment/);
    await assert.rejects(() => completeDemoRun({ runId: loaded.record.runId }), /does not own/);
    await runSettlementReconcile();
    assert.equal(process.exitCode, 1);
    assert.equal((await loadPendingSettlement()).kind, "demo-run");
    process.exitCode = 0;
  `);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /reference demo remains locked/);
  assert.match(second.stdout, /automatic resume is not implemented/);
  assert.doesNotMatch(second.stdout, /no prepared payment is pending/);
});

test("demo versus pay and demo versus demo processes share exactly one atomic claim", async () => {
  for (const other of ["pay", "demo"]) {
    const root = await home();
    const moduleUrl = new URL("./settlement-store.ts", import.meta.url).href;
    const demo = `import { claimDemoRun } from ${JSON.stringify(moduleUrl)}; await claimDemoRun(${JSON.stringify(DEMO_CONTEXT)});`;
    const pay = `import { claimPendingSettlement } from ${JSON.stringify(moduleUrl)}; await claimPendingSettlement("pay", ${JSON.stringify(DEMO_CONTEXT.contractId)}, ${JSON.stringify(pending())}, ${JSON.stringify(DEMO_CONTEXT)});`;
    const results = await Promise.all([isolatedProcess(root, demo), isolatedProcess(root, other === "pay" ? pay : demo)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
    assert.ok(["pending", "demo-run"].includes((await loadPendingSettlement()).kind));
  }
});

test("paused payment clear, acknowledgment, and completion cannot delete or overwrite a replacement demo", { timeout: 15_000 }, async () => {
  for (const operation of ["clear", "acknowledge", "complete"] as const) {
    await home();
    const hash = "a".repeat(64);
    await claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending());
    if (operation === "acknowledge") await markSettlementCompleted(hash);
    const directory = settlementDirectory();
    const originalRm = fsPromises.rm;
    const originalRename = fsPromises.rename;
    let entered!: () => void;
    let release!: () => void;
    const atMutation = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    let paused = false;
    fsPromises.rm = (async (path, options) => {
      if (!paused && operation !== "complete" && path === directory) {
        paused = true;
        entered();
        await released;
      }
      return originalRm(path, options);
    }) as typeof fsPromises.rm;
    fsPromises.rename = (async (from, to) => {
      if (!paused && operation === "complete" && to === join(directory, "state.json")) {
        paused = true;
        entered();
        await released;
      }
      return originalRename(from, to);
    }) as typeof fsPromises.rename;
    syncBuiltinESMExports();
    const first = operation === "clear" ? clearPendingSettlement(hash)
      : operation === "acknowledge" ? acknowledgeCompletedSettlement(hash) : markSettlementCompleted(hash);
    try {
      await Promise.race([atMutation, first.then(() => { throw new Error("operation did not reach the intercepted filesystem mutation"); })]);
      await assert.rejects(() => clearPendingSettlement(hash), /journal operation is in progress/);
      await assert.rejects(() => acknowledgeCompletedSettlement(hash), /journal operation is in progress/);
      await assert.rejects(() => claimDemoRun(DEMO_CONTEXT), /journal operation is in progress/);
    } finally {
      release();
      await first;
      fsPromises.rm = originalRm;
      fsPromises.rename = originalRename;
      syncBuiltinESMExports();
    }
    if (operation === "complete") await acknowledgeCompletedSettlement(hash);
    const next = await claimDemoRun(DEMO_CONTEXT);
    const current = await loadPendingSettlement();
    assert.equal(current.kind, "demo-run");
    if (current.kind === "demo-run") assert.equal(current.record.runId, next.runId);
  }
});

test("an abandoned journal-operation lock blocks reads and every competing journal mutation", async () => {
  const root = await home();
  const lock = join(root, "pending-settlement-operation");
  await mkdir(lock, { mode: 0o700 });
  for (const operation of [
    loadPendingSettlement,
    clearPendingSettlement,
    () => claimDemoRun(DEMO_CONTEXT),
    () => claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending()),
    () => markSettlementCompleted("a".repeat(64)),
    () => acknowledgeCompletedSettlement("a".repeat(64)),
  ]) await assert.rejects(operation, /journal operation is in progress or was interrupted/);
  assert.ok((await stat(lock)).isDirectory());
});

test("only the owning demo can clear after metadata and receipt acknowledgment; stale owners cannot clear another run", async () => {
  await home();
  const claim = await claimDemoRun(DEMO_CONTEXT);
  await assert.rejects(() => completeDemoRun(claim), /recorded mandate/);
  await updateDemoRun(claim, { mandateId: DEMO_MANDATE, registrationTx: "c".repeat(64), allowanceTx: "d".repeat(64), origin: DEMO_ORIGIN });
  const store = new FileSettlementReceiptStore(join(demoRecoveryDirectory(DEMO_MANDATE), "receipts.json"));
  const receipt = demoReceipt();
  await store.savePending(receipt);
  await assert.rejects(() => completeDemoRun(claim), /still unacknowledged/);
  assert.equal((await loadPendingSettlement()).kind, "demo-run");
  await acceptedDemoOutcomes();
  await store.clearPending(receipt.receiptId);
  const completions = await Promise.allSettled([completeDemoRun(claim), completeDemoRun(claim)]);
  assert.equal(completions.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await loadPendingSettlement()).kind, "none");
  const next = await claimDemoRun(DEMO_CONTEXT);
  await assert.rejects(() => completeDemoRun(claim), /does not own/);
  await assert.rejects(() => completeDemoRun({ runId: next.runId }), /does not own/);
  const retained = await loadPendingSettlement();
  assert.equal(retained.kind, "demo-run");
  if (retained.kind === "demo-run") assert.equal(retained.record.runId, next.runId);
});

test("malformed demo marker fails closed for load, reconcile, clear, and payment acknowledgment", async () => {
  await home();
  await mkdir(settlementDirectory(), { mode: 0o700 });
  await writeFile(join(settlementDirectory(), "state.json"), JSON.stringify({ version: 1, state: "demo-run" }), { mode: 0o600 });
  for (const operation of [loadPendingSettlement, assertNoPendingSettlement, runSettlementReconcile, clearPendingSettlement, () => acknowledgeCompletedSettlement("a".repeat(64))]) {
    await assert.rejects(operation, /demo-run marker schema/);
  }
  assert.equal(JSON.parse(await readFile(join(settlementDirectory(), "state.json"), "utf8")).state, "demo-run");
});

test("legacy pending demo receipts block new demo/pay claims and reconcile never reports none", async () => {
  await home();
  const store = new FileSettlementReceiptStore(join(demoRecoveryDirectory(DEMO_MANDATE), "receipts.json"));
  await store.savePending(demoReceipt());
  const loaded = await loadPendingSettlement();
  assert.equal(loaded.kind, "legacy-demo");
  if (loaded.kind === "legacy-demo") assert.deepEqual(loaded.evidence[0]?.transactionHashes, ["a".repeat(64)]);
  await assert.rejects(() => runDemo("research-agent", { network: "mainnet" }), /earlier demo requires manual exact-receipt recovery/);
  await assert.rejects(() => claimDemoRun(DEMO_CONTEXT), /earlier demo/);
  await assert.rejects(() => claimPendingSettlement("pay", TESTNET.mandateRegistryId, pending()), /earlier demo/);
  await assert.rejects(() => clearPendingSettlement(), /payment-only operation/);
  const messages: string[] = [];
  const original = console.log;
  try {
    console.log = (...items: unknown[]) => { messages.push(items.join(" ")); };
    await runSettlementReconcile();
  } finally { console.log = original; }
  assert.equal(process.exitCode, 1);
  assert.match(messages.join("\n"), /legacy reference-demo evidence/);
  assert.doesNotMatch(messages.join("\n"), /no prepared payment is pending/);
  assert.equal((await store.listPending()).length, 1);
});

test("legacy interrupted outcomes without a receipt block replacement; completed accepted outcomes allow a new run", async () => {
  await home();
  const store = new FilePurchaseOutcomeStore(join(demoRecoveryDirectory(DEMO_MANDATE), "outcomes.json"));
  const identity = createPurchaseIdentity({ mandateId: DEMO_MANDATE, url: `${DEMO_ORIGIN}/source/market`, sourceId: "market" });
  await store.claim(identity, randomUUID(), 1_700_000_000);
  assert.equal((await findUnresolvedDemoEvidence()).length, 1);
  await assert.rejects(() => claimDemoRun(DEMO_CONTEXT), /earlier demo/);

  await home();
  await acceptedDemoOutcomes();
  assert.deepEqual(await findUnresolvedDemoEvidence(), []);
  await assert.doesNotReject(() => claimDemoRun(DEMO_CONTEXT));
});

test("malformed or widened-permission journal state fails closed", async () => {
  await home();
  await mkdir(settlementDirectory(), { mode: 0o700 });
  await writeFile(join(settlementDirectory(), "state.json"), "{}\n", { mode: 0o600 });
  await assert.rejects(() => loadPendingSettlement(), /schema/);
});

test("NOT_FOUND clears only after expiry with the complete history window retained", () => {
  const record = pending();
  assert.equal(classifyMissingSettlement(record, {
    latestLedgerCloseTime: record.validUntil,
    oldestLedgerCloseTime: record.submittedAt - 100,
  }), "pending");
  assert.equal(classifyMissingSettlement(record, {
    latestLedgerCloseTime: record.validUntil + 1,
    oldestLedgerCloseTime: record.submittedAt - 100,
  }), "expired");
  assert.equal(classifyMissingSettlement(record, {
    latestLedgerCloseTime: record.validUntil + 1,
    oldestLedgerCloseTime: record.submittedAt + 1,
  }), "history-pruned");
  for (const evidence of [
    {},
    { latestLedgerCloseTime: record.validUntil + 1 },
    { oldestLedgerCloseTime: record.submittedAt },
    { latestLedgerCloseTime: NaN, oldestLedgerCloseTime: NaN },
    { latestLedgerCloseTime: Infinity, oldestLedgerCloseTime: 1 },
    { latestLedgerCloseTime: record.validUntil + 1, oldestLedgerCloseTime: -Infinity },
    { latestLedgerCloseTime: -1, oldestLedgerCloseTime: -2 },
    { latestLedgerCloseTime: record.validUntil + 1, oldestLedgerCloseTime: -1 },
    { latestLedgerCloseTime: Number.MAX_SAFE_INTEGER + 1, oldestLedgerCloseTime: record.submittedAt },
    { latestLedgerCloseTime: String(record.validUntil + 1), oldestLedgerCloseTime: record.submittedAt },
    { latestLedgerCloseTime: record.validUntil + 1, oldestLedgerCloseTime: 0 },
    { latestLedgerCloseTime: record.validUntil + 1, oldestLedgerCloseTime: record.validUntil + 2 },
    { latestLedgerCloseTime: record.validUntil + 1.5, oldestLedgerCloseTime: record.submittedAt },
  ]) assert.equal(classifyMissingSettlement(record, evidence as { latestLedgerCloseTime: number; oldestLedgerCloseTime: number }), "invalid-history");
});

test("reconciliation retains the exact journal when NOT_FOUND omits history timestamps", async (t) => {
  await home();
  const record = pending();
  await claimPendingSettlement("pay", TESTNET.mandateRegistryId, record);
  let broadcasts = 0;
  let unexpectedHttp = 0;
  const messages: string[] = [];
  t.mock.method(console, "log", (...items: unknown[]) => { messages.push(items.join(" ")); });
  t.mock.method(rpc.Server.prototype, "getNetwork", async () => ({ passphrase: TESTNET.networkPassphrase }));
  t.mock.method(rpc.Server.prototype, "getTransaction", async (hash: string) => {
    assert.equal(hash, record.txHash);
    return { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
  });
  t.mock.method(rpc.Server.prototype, "sendTransaction", async () => {
    broadcasts += 1;
    throw new Error("reconciliation must never broadcast");
  });
  t.mock.method(globalThis, "fetch", async () => {
    unexpectedHttp += 1;
    throw new Error("unexpected live HTTP request");
  });
  await runSettlementReconcile();
  assert.equal(process.exitCode, 1);
  const retained = await loadPendingSettlement();
  assert.equal(retained.kind, "pending");
  if (retained.kind === "pending") assert.deepEqual(retained.record.pending, record);
  await assert.rejects(() => assertNoPendingSettlement(), /unresolved/);
  assert.equal(broadcasts, 0);
  assert.equal(unexpectedHttp, 0);
  assert.match(messages.join("\n"), /history.*invalid|invalid.*history/i);
});
