import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import type { PendingSettlement } from "@ackrate/core";
import { TESTNET } from "@ackrate/stellar";
import { FileSettlementReceiptStore } from "../../../apps/consumer-agent/src/receipt-store.js";
import { FilePurchaseOutcomeStore, createPurchaseIdentity } from "../../../apps/consumer-agent/src/outcome-store.js";
import { FileBoundRedemptionStore } from "../../../apps/fulfillment-agent/src/redemption-store.js";
import { ackrateHome } from "./secrets.js";

export type SettlementSource = "pay" | "demo";

interface StoredSettlementBase {
  version: 4;
  source: SettlementSource;
  network: "testnet" | "mainnet";
  rpcUrl: string;
  contractId: string;
  assetId: string | null;
  user: string | null;
  agent: string | null;
  merchant: string | null;
  pending: Readonly<PendingSettlement>;
}

export interface StoredPendingSettlement extends StoredSettlementBase {
  state: "pending";
}

export interface StoredCompletedSettlement extends StoredSettlementBase {
  state: "completed";
  completedAt: number;
}

export type StoredSettlement = StoredPendingSettlement | StoredCompletedSettlement;

export interface DemoRunContext {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  contractId: string;
  assetId: string;
  user: string;
  agent: string;
  merchant: string;
}

export interface StoredDemoRun extends DemoRunContext {
  version: 1;
  state: "demo-run";
  source: "demo";
  runId: string;
  startedAt: number;
  mandateId: string | null;
  registrationTx: string | null;
  allowanceTx: string | null;
  origin: string | null;
}

export interface DemoRunClaim { readonly runId: string }
const ownedDemoClaims = new WeakSet<DemoRunClaim>();
const completingDemoClaims = new WeakSet<DemoRunClaim>();

export interface DemoRecoveryEvidence {
  directory: string;
  reason: string;
  transactionHashes: readonly string[];
}

export type LoadedSettlement =
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "demo-run"; record: Readonly<StoredDemoRun> }
  | { kind: "legacy-demo"; evidence: readonly DemoRecoveryEvidence[] }
  | { kind: "pending"; record: Readonly<StoredPendingSettlement> }
  | { kind: "completed"; record: Readonly<StoredCompletedSettlement> };

const DIRECTORY = "pending-settlement";
const STATE = "state.json";

export function settlementDirectory(): string {
  return join(ackrateHome(), DIRECTORY);
}

function statePath(): string {
  return join(settlementDirectory(), STATE);
}

/** The stable sibling lock prevents stale readers from deleting or overwriting a new run. */
async function withJournalLock<T>(operation: () => Promise<T>): Promise<T> {
  const home = ackrateHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const lock = join(home, "pending-settlement-operation");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`a journal operation is in progress or was interrupted; retain ${lock} and ${settlementDirectory()} for manual evidence review before another payment or demo`);
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    // Only this operation can own this sibling lock; competing operations fail
    // closed rather than clearing it. A crashed process leaves it for review.
    await rm(lock, { recursive: true });
  }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function demoRecoveryDirectory(mandateId: string | null): string {
  return mandateId === null
    ? join(ackrateHome(), "research-agent-demo")
    : join(ackrateHome(), "research-agent-demo", mandateId);
}

function validateDemoRun(value: unknown): Readonly<StoredDemoRun> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("demo-run marker is invalid");
  const record = value as StoredDemoRun;
  let rpc: URL | undefined;
  let origin: URL | undefined;
  try {
    rpc = new URL(record.rpcUrl);
    if (record.origin !== null) origin = new URL(record.origin);
  } catch { /* Invalid metadata fails closed below. */ }
  if (
    !exactKeys(record, ["version", "state", "source", "runId", "startedAt", "network", "rpcUrl", "contractId", "assetId", "user", "agent", "merchant", "mandateId", "registrationTx", "allowanceTx", "origin"])
    || record.version !== 1 || record.state !== "demo-run" || record.source !== "demo"
    || typeof record.runId !== "string" || !/^[0-9a-f-]{36}$/.test(record.runId)
    || !Number.isSafeInteger(record.startedAt) || record.startedAt <= 0
    || (record.network !== "testnet" && record.network !== "mainnet")
    || !rpc || rpc.protocol !== "https:" || Boolean(rpc.username || rpc.password)
    || ![record.contractId, record.assetId].every((address) => typeof address === "string" && /^C[A-Z2-7]{55}$/.test(address))
    || ![record.user, record.agent, record.merchant].every((address) => typeof address === "string" && /^G[A-Z2-7]{55}$/.test(address))
    || new Set([record.user, record.agent, record.merchant]).size !== 3
    || ![record.mandateId, record.registrationTx, record.allowanceTx].every((hash) => hash === null || (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)))
    || (record.origin !== null && (!origin || !["http:", "https:"].includes(origin.protocol) || origin.origin !== record.origin || Boolean(origin.username || origin.password)))
  ) throw new Error("demo-run marker schema is invalid; retain it for manual evidence review");
  return Object.freeze({ ...record });
}

/** Inspect legacy reference stores without printing their proofs or protected bodies. */
export async function findUnresolvedDemoEvidence(): Promise<readonly DemoRecoveryEvidence[]> {
  const root = demoRecoveryDirectory(null);
  let entries;
  try {
    await assertDirectoryIsPrivate(root);
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const evidence: DemoRecoveryEvidence[] = [];
  for (const entry of entries) {
    // The shared challenge-secret is intentionally never opened by this scan.
    if (!/^[0-9a-f]{64}$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    let transactionHashes: string[] = [];
    try {
      await assertDirectoryIsPrivate(directory);
      for (const name of ["receipts.json", "outcomes.json", "redemptions.json"]) {
        try {
          const info = await lstat(join(directory, name));
          if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 4 * 1024 * 1024) {
            throw new Error("reference evidence is not a bounded private regular file");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const receipts = await new FileSettlementReceiptStore(join(directory, "receipts.json")).listPending();
      transactionHashes = receipts.map((receipt) => receipt.txHash);
      if (receipts.length > 0) throw new Error("settlement or delivery receipts are still pending");
      const raw = JSON.parse(await readFile(join(directory, "outcomes.json"), "utf8")) as {
        version: number; records: Record<string, { identity: { mandateId: string; url: string; sourceId: string } }>;
      };
      if (!raw || raw.version !== 1 || !raw.records || typeof raw.records !== "object" || Array.isArray(raw.records)) {
        throw new Error("outcome evidence is malformed");
      }
      const records = Object.values(raw.records);
      if (records.length !== 4) throw new Error("the previous demo has incomplete application outcomes");
      const outcomes = new FilePurchaseOutcomeStore(join(directory, "outcomes.json"));
      const completedSources = new Set<string>();
      for (const record of records) {
        const identity = createPurchaseIdentity(record.identity);
        if (identity.mandateId !== entry.name || completedSources.has(identity.sourceId)) throw new Error("outcome identity does not match this demo");
        const found = await outcomes.lookup(identity); // Validates every stored record and integrity digest.
        if (found.kind !== "completed") throw new Error("a previous purchase execution is unresolved");
        if (["market", "academic", "news"].includes(identity.sourceId)) {
          if (found.outcome.kind !== "delivered") throw new Error("a previous paid source was not durably delivered");
        } else if (identity.sourceId !== "patents" || found.outcome.kind !== "rejected" || found.outcome.reason !== "budget exceeded") {
          throw new Error("the previous demo lacks the expected no-payment budget rejection");
        }
        completedSources.add(identity.sourceId);
      }
      if ((await new FileBoundRedemptionStore(join(directory, "redemptions.json")).listExecuting()).length > 0) {
        throw new Error("a fulfillment execution is unresolved");
      }
    } catch {
      // Do not echo parser errors that could contain protected receipt or outcome contents.
      evidence.push({ directory, transactionHashes, reason: "unresolved or unreadable reference-agent receipt/outcome evidence" });
    }
  }
  return evidence;
}

async function assertNoLegacyDemoEvidence(): Promise<void> {
  const evidence = await findUnresolvedDemoEvidence();
  if (evidence.length > 0) {
    throw new Error(`an earlier demo requires manual exact-receipt recovery; retained evidence: ${evidence.map((item) => item.directory).join(", ")}; do not start a replacement run`);
  }
}

function validatePending(value: unknown): Readonly<PendingSettlement> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pending settlement record is not an object");
  }
  const pending = value as PendingSettlement;
  const keys = ["txHash", "mandateId", "amount", "expectedSeq", "submittedAt", "validUntil"];
  if (pending.receiptId !== undefined) keys.push("receiptId");
  if (
    !exactKeys(pending, keys)
    || typeof pending.txHash !== "string"
    || !/^[0-9a-f]{64}$/.test(pending.txHash)
    || typeof pending.mandateId !== "string"
    || !/^[0-9a-f]{64}$/.test(pending.mandateId)
    || typeof pending.amount !== "string"
    || !/^\d+(?:\.\d+)?$/.test(pending.amount)
    || typeof pending.expectedSeq !== "string"
    || !/^\d+$/.test(pending.expectedSeq)
    || !Number.isSafeInteger(pending.submittedAt)
    || !Number.isSafeInteger(pending.validUntil)
    || pending.submittedAt <= 0
    || pending.validUntil <= pending.submittedAt
    || (pending.receiptId !== undefined && !/^[0-9a-f]{64}$/.test(pending.receiptId))
  ) {
    throw new Error("pending settlement record schema is invalid");
  }
  return Object.freeze({ ...pending });
}

function validateRecord(value: unknown): Readonly<StoredSettlement> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settlement journal is not an object");
  }
  const raw = value as Record<string, unknown>;
  const legacy = (raw.version === 2 || raw.version === 3) && raw.network === "testnet";
  const record = (legacy ? {
    ...raw,
    version: 4,
    rpcUrl: raw.rpcUrl ?? TESTNET.rpcUrl,
    assetId: null,
    user: null,
    agent: null,
    merchant: null,
  } : raw) as unknown as StoredSettlement;
  const expectedKeys = record.state === "completed"
    ? ["version", "state", "source", "network", "rpcUrl", "contractId", "assetId", "user", "agent", "merchant", "pending", "completedAt"]
    : ["version", "state", "source", "network", "rpcUrl", "contractId", "assetId", "user", "agent", "merchant", "pending"];
  let rpc: URL | undefined;
  try {
    rpc = new URL(record.rpcUrl);
  } catch {
    // Rejected by the schema condition below.
  }
  if (
    !exactKeys(record, expectedKeys)
    || record.version !== 4
    || (record.state !== "pending" && record.state !== "completed")
    || (record.source !== "pay" && record.source !== "demo")
    || (record.network !== "testnet" && record.network !== "mainnet")
    || !rpc
    || rpc.protocol !== "https:"
    || Boolean(rpc.username || rpc.password)
    || typeof record.contractId !== "string"
    || !/^C[A-Z2-7]{55}$/.test(record.contractId)
    || (record.assetId !== null && !/^C[A-Z2-7]{55}$/.test(record.assetId))
    || (record.user !== null && !/^G[A-Z2-7]{55}$/.test(record.user))
    || (record.agent !== null && !/^G[A-Z2-7]{55}$/.test(record.agent))
    || (record.merchant !== null && !/^G[A-Z2-7]{55}$/.test(record.merchant))
    || (record.network === "mainnet" && [record.assetId, record.user, record.agent, record.merchant].some((value) => value === null))
  ) {
    throw new Error("settlement journal schema is invalid");
  }
  const pending = validatePending(record.pending);
  if (record.state === "completed") {
    if (
      !Number.isSafeInteger(record.completedAt)
      || record.completedAt < pending.submittedAt
    ) {
      throw new Error("completed settlement journal schema is invalid");
    }
    return Object.freeze({ ...record, pending });
  }
  return Object.freeze({ ...record, pending });
}

async function assertDirectoryIsPrivate(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("settlement journal path is not a private directory");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error("settlement journal directory permissions are not private");
  }
}

export async function assertNoPendingSettlement(): Promise<void> {
  const loaded = await loadPendingSettlement();
  if (loaded.kind === "none") return;
  if (loaded.kind === "demo-run") {
    throw new Error(`a reference demo is unresolved; retain ${settlementDirectory()} and ${demoRecoveryDirectory(loaded.record.mandateId)} for manual exact-receipt recovery; run \`ackrate settlement reconcile\` for its recorded context, not a replacement demo`);
  }
  if (loaded.kind === "legacy-demo") await assertNoLegacyDemoEvidence();
  throw new Error("a payment is unresolved or unacknowledged; run `ackrate settlement reconcile` before another payment");
}

async function writeState(record: Readonly<StoredSettlement | StoredDemoRun>): Promise<void> {
  const directory = settlementDirectory();
  const temporary = join(directory, `${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, statePath());
    await chmod(statePath(), 0o600);
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Claim the same atomic directory as pay before any demo registration or spending. */
export async function claimDemoRun(context: Readonly<DemoRunContext>): Promise<DemoRunClaim> {
  return withJournalLock(() => claimDemoRunUnlocked(context));
}

async function claimDemoRunUnlocked(context: Readonly<DemoRunContext>): Promise<DemoRunClaim> {
  const record = validateDemoRun({
    ...context, version: 1, state: "demo-run", source: "demo", runId: randomUUID(),
    startedAt: Math.floor(Date.now() / 1_000), mandateId: null, registrationTx: null, allowanceTx: null, origin: null,
  });
  await assertNoLegacyDemoEvidence();
  const home = ackrateHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  try {
    await mkdir(settlementDirectory(), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("another payment or demo is unresolved; run `ackrate settlement reconcile` before another demo");
    }
    throw error;
  }
  // On a write failure the directory stays claimed. Reconcile must not assume
  // an empty claim is abandoned while its owner may still be preparing metadata.
  await writeState(record);
  const parent = await open(home, "r");
  try { await parent.sync(); } finally { await parent.close(); }
  const claim = Object.freeze({ runId: record.runId });
  ownedDemoClaims.add(claim);
  return claim;
}

async function requireOwnedDemoRun(claim: DemoRunClaim): Promise<Readonly<StoredDemoRun>> {
  if (!ownedDemoClaims.has(claim)) throw new Error("this process does not own the demo-run claim; manual recovery is required");
  const loaded = await loadPendingSettlementUnlocked();
  if (loaded.kind !== "demo-run" || loaded.record.runId !== claim.runId) {
    throw new Error("refusing to change a different demo-run claim");
  }
  return loaded.record;
}

export async function updateDemoRun(
  claim: DemoRunClaim,
  patch: Partial<Pick<StoredDemoRun, "mandateId" | "registrationTx" | "allowanceTx" | "origin">>,
): Promise<void> {
  await withJournalLock(async () => {
    const record = await requireOwnedDemoRun(claim);
    await writeState(validateDemoRun({ ...record, ...patch }));
  });
}

/** Call only after the demo's final delivery, chain-state, and balance checks pass. */
export async function completeDemoRun(claim: DemoRunClaim): Promise<void> {
  return withJournalLock(() => completeDemoRunUnlocked(claim));
}

async function completeDemoRunUnlocked(claim: DemoRunClaim): Promise<void> {
  if (completingDemoClaims.has(claim)) throw new Error("demo-run completion is already in progress");
  completingDemoClaims.add(claim);
  try {
    const record = await requireOwnedDemoRun(claim);
    if (!record.mandateId || !record.registrationTx || !record.allowanceTx || !record.origin) {
      throw new Error("cannot complete a demo without its recorded mandate, transactions, and delivery origin");
    }
    const pending = await new FileSettlementReceiptStore(join(demoRecoveryDirectory(record.mandateId), "receipts.json")).listPending();
    if (pending.length > 0) throw new Error("demo delivery is still unacknowledged; retain its exact receipts");
    await assertNoLegacyDemoEvidence(); // Application outcomes and fulfillment must also be complete.
    // An old/stale claim object cannot remove a subsequent run's directory.
    await requireOwnedDemoRun(claim);
    await rm(settlementDirectory(), { recursive: true });
    ownedDemoClaims.delete(claim);
    const parent = await open(ackrateHome(), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    completingDemoClaims.delete(claim);
  }
}

/** Atomic cross-process claim. It resolves only after the exact signed hash is fsynced. */
export async function claimPendingSettlement(
  source: SettlementSource,
  contractId: string,
  pending: Readonly<PendingSettlement>,
  context: Readonly<{
    network: "testnet" | "mainnet";
    rpcUrl: string;
    assetId?: string;
    user?: string;
    agent?: string;
    merchant?: string;
  }> = {
    network: "testnet",
    rpcUrl: TESTNET.rpcUrl,
  },
): Promise<void> {
  return withJournalLock(() => claimPendingSettlementUnlocked(source, contractId, pending, context));
}

async function claimPendingSettlementUnlocked(
  source: SettlementSource,
  contractId: string,
  pending: Readonly<PendingSettlement>,
  context: Readonly<{ network: "testnet" | "mainnet"; rpcUrl: string; assetId?: string; user?: string; agent?: string; merchant?: string }>,
): Promise<void> {
  await assertNoLegacyDemoEvidence();
  const home = ackrateHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  const directory = settlementDirectory();
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("another prepared payment is unresolved; run `ackrate settlement reconcile`");
    }
    throw error;
  }

  try {
    const record = validateRecord({
      version: 4,
      state: "pending",
      source,
      network: context.network,
      rpcUrl: context.rpcUrl,
      contractId,
      assetId: context.assetId ?? null,
      user: context.user ?? null,
      agent: context.agent ?? null,
      merchant: context.merchant ?? null,
      pending,
    });
    await writeState(record);
    const parent = await open(home, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function loadPendingSettlement(): Promise<LoadedSettlement> {
  return withJournalLock(loadPendingSettlementUnlocked);
}

async function loadPendingSettlementUnlocked(): Promise<LoadedSettlement> {
  const directory = settlementDirectory();
  try {
    await assertDirectoryIsPrivate(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const evidence = await findUnresolvedDemoEvidence();
      return evidence.length > 0 ? { kind: "legacy-demo", evidence } : { kind: "none" };
    }
    throw error;
  }
  let raw: string;
  try {
    raw = await readFile(statePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "empty" };
    throw error;
  }
  const info = await lstat(statePath());
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("settlement journal file is not a private regular file");
  }
  const parsed = JSON.parse(raw) as { state?: unknown } | null;
  if (parsed?.state === "demo-run") return { kind: "demo-run", record: validateDemoRun(parsed) };
  const record = validateRecord(parsed);
  return record.state === "completed"
    ? { kind: "completed", record }
    : { kind: "pending", record };
}

export async function clearPendingSettlement(expectedTxHash?: string): Promise<void> {
  return withJournalLock(() => clearPendingSettlementUnlocked(expectedTxHash));
}

async function clearPendingSettlementUnlocked(expectedTxHash?: string): Promise<void> {
  const loaded = await loadPendingSettlementUnlocked();
  if (loaded.kind === "none") return;
  if (loaded.kind === "demo-run" || loaded.kind === "legacy-demo") {
    throw new Error("refusing to clear reference-demo evidence with a payment-only operation; manual exact-receipt recovery is required");
  }
  if (loaded.kind === "completed") {
    throw new Error("refusing to clear a completed payment before explicit acknowledgment");
  }
  if (loaded.kind === "pending" && expectedTxHash !== undefined && loaded.record.pending.txHash !== expectedTxHash) {
    throw new Error("refusing to clear a different pending settlement hash");
  }
  if (loaded.kind === "empty") {
    throw new Error("refusing to clear an empty journal claim; its owner may still be preparing metadata; manual evidence review is required");
  }
  await rm(settlementDirectory(), { recursive: true, force: true });
}

/** Persist final success before any success is reported to the caller. */
export async function markSettlementCompleted(expectedTxHash: string): Promise<void> {
  return withJournalLock(() => markSettlementCompletedUnlocked(expectedTxHash));
}

async function markSettlementCompletedUnlocked(expectedTxHash: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(expectedTxHash)) {
    throw new Error("completed settlement hash must be canonical 64-character lowercase hex");
  }
  const loaded = await loadPendingSettlementUnlocked();
  if (loaded.kind === "demo-run" || loaded.kind === "legacy-demo") {
    throw new Error("a reference-demo run cannot be completed by payment reconciliation");
  }
  if (loaded.kind === "none" || loaded.kind === "empty") {
    throw new Error("cannot complete a settlement without its durable prepared record");
  }
  if (loaded.record.pending.txHash !== expectedTxHash) {
    throw new Error("refusing to complete a different settlement hash");
  }
  if (loaded.kind === "completed") return;
  const completed = validateRecord({
    ...loaded.record,
    state: "completed",
    completedAt: Math.max(Math.floor(Date.now() / 1_000), loaded.record.pending.submittedAt),
  });
  await writeState(completed);
}

/** Remove completed evidence only after the human/application accepts that exact success. */
export async function acknowledgeCompletedSettlement(expectedTxHash: string): Promise<void> {
  return withJournalLock(() => acknowledgeCompletedSettlementUnlocked(expectedTxHash));
}

async function acknowledgeCompletedSettlementUnlocked(expectedTxHash: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(expectedTxHash)) {
    throw new Error("acknowledgment hash must be canonical 64-character lowercase hex");
  }
  const loaded = await loadPendingSettlementUnlocked();
  if (loaded.kind !== "completed") {
    throw new Error("no completed payment is awaiting acknowledgment");
  }
  if (loaded.record.pending.txHash !== expectedTxHash) {
    throw new Error("refusing to acknowledge a different completed settlement hash");
  }
  await rm(settlementDirectory(), { recursive: true, force: true });
}

export type MissingSettlementDecision = "pending" | "expired" | "history-pruned" | "invalid-history";

export function classifyMissingSettlement(
  pending: Readonly<PendingSettlement>,
  evidence: { latestLedgerCloseTime: number; oldestLedgerCloseTime: number },
): MissingSettlementDecision {
  if (
    !Number.isSafeInteger(evidence.latestLedgerCloseTime) || evidence.latestLedgerCloseTime <= 0
    || !Number.isSafeInteger(evidence.oldestLedgerCloseTime) || evidence.oldestLedgerCloseTime <= 0
    || evidence.oldestLedgerCloseTime > evidence.latestLedgerCloseTime
  ) return "invalid-history";
  if (evidence.latestLedgerCloseTime <= pending.validUntil) return "pending";
  if (evidence.oldestLedgerCloseTime > pending.submittedAt) return "history-pruned";
  return "expired";
}
