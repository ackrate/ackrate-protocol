import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { SettlementReceipt, SettlementReceiptStore } from "@ackrate/core";

type Sql = NeonQueryFunction<false, false>;

const memory = globalThis as typeof globalThis & {
  __ackrateChallenges?: Set<string>;
  __ackrateToolCalls?: Map<string, ToolCallRecord>;
  __ackrateReceipts?: Map<string, SettlementReceipt>;
};

memory.__ackrateChallenges ??= new Set();
memory.__ackrateToolCalls ??= new Map();
memory.__ackrateReceipts ??= new Map();

let sqlClient: Sql | null | undefined;
let initialization: Promise<void> | undefined;

function sql(): Sql | null {
  if (sqlClient !== undefined) return sqlClient;
  sqlClient = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
  return sqlClient;
}

async function initialize(): Promise<Sql | null> {
  const client = sql();
  if (!client) return null;
  initialization ??= (async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ackrate_auth_challenges (
        jti text PRIMARY KEY,
        expires_at bigint NOT NULL,
        consumed_at bigint NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ackrate_tool_calls (
        session_id text NOT NULL,
        tool_call_id text NOT NULL,
        mandate_id text NOT NULL,
        source_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('running', 'succeeded', 'delivery_pending', 'failed')),
        result jsonb,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL,
        PRIMARY KEY (session_id, tool_call_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ackrate_payment_receipts (
        receipt_id text PRIMARY KEY,
        session_id text NOT NULL,
        mandate_id text NOT NULL,
        receipt jsonb NOT NULL,
        created_at bigint NOT NULL
      )
    `);
  })();
  await initialization;
  return client;
}

export async function consumeChallenge(jti: string, expiresAt: number): Promise<boolean> {
  const client = await initialize();
  if (!client) {
    if (memory.__ackrateChallenges!.has(jti)) return false;
    memory.__ackrateChallenges!.add(jti);
    return true;
  }
  const rows = await client.query(
    `INSERT INTO ackrate_auth_challenges (jti, expires_at, consumed_at)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING jti`,
    [jti, expiresAt, Math.floor(Date.now() / 1_000)],
  );
  return rows.length === 1;
}

export interface ToolCallRecord {
  sessionId: string;
  toolCallId: string;
  mandateId: string;
  sourceId: string;
  status: "running" | "succeeded" | "delivery_pending" | "failed";
  result: unknown;
}

const toolKey = (sessionId: string, toolCallId: string) => `${sessionId}:${toolCallId}`;

export async function reserveToolCall(input: Omit<ToolCallRecord, "status" | "result">): Promise<{ created: boolean; record: ToolCallRecord }> {
  const client = await initialize();
  const record: ToolCallRecord = { ...input, status: "running", result: null };
  if (!client) {
    const key = toolKey(input.sessionId, input.toolCallId);
    const existing = memory.__ackrateToolCalls!.get(key);
    if (existing) return { created: false, record: existing };
    memory.__ackrateToolCalls!.set(key, record);
    return { created: true, record };
  }
  const now = Math.floor(Date.now() / 1_000);
  const inserted = await client.query(
    `INSERT INTO ackrate_tool_calls
       (session_id, tool_call_id, mandate_id, source_id, status, result, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'running', NULL, $5, $5)
     ON CONFLICT DO NOTHING RETURNING *`,
    [input.sessionId, input.toolCallId, input.mandateId, input.sourceId, now],
  );
  const rows = inserted.length ? inserted : await client.query(
    `SELECT * FROM ackrate_tool_calls WHERE session_id = $1 AND tool_call_id = $2`,
    [input.sessionId, input.toolCallId],
  );
  const row = rows[0] as Record<string, unknown>;
  return {
    created: inserted.length === 1,
    record: {
      sessionId: String(row.session_id),
      toolCallId: String(row.tool_call_id),
      mandateId: String(row.mandate_id),
      sourceId: String(row.source_id),
      status: row.status as ToolCallRecord["status"],
      result: row.result ?? null,
    },
  };
}

export async function completeToolCall(
  input: Pick<ToolCallRecord, "sessionId" | "toolCallId" | "status" | "result">,
): Promise<void> {
  const client = await initialize();
  if (!client) {
    const key = toolKey(input.sessionId, input.toolCallId);
    const prior = memory.__ackrateToolCalls!.get(key);
    if (!prior) throw new Error("tool call was not reserved");
    memory.__ackrateToolCalls!.set(key, { ...prior, status: input.status, result: input.result });
    return;
  }
  await client.query(
    `UPDATE ackrate_tool_calls SET status = $3, result = $4::jsonb, updated_at = $5
     WHERE session_id = $1 AND tool_call_id = $2`,
    [input.sessionId, input.toolCallId, input.status, JSON.stringify(input.result), Math.floor(Date.now() / 1_000)],
  );
}

export class DurableReceiptStore implements SettlementReceiptStore {
  constructor(private readonly sessionId: string, private readonly mandateId: string) {}

  async savePending(receipt: Readonly<SettlementReceipt>): Promise<void> {
    const client = await initialize();
    if (!client) {
      memory.__ackrateReceipts!.set(receipt.receiptId, receipt);
      return;
    }
    await client.query(
      `INSERT INTO ackrate_payment_receipts (receipt_id, session_id, mandate_id, receipt, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (receipt_id) DO UPDATE SET receipt = EXCLUDED.receipt`,
      [receipt.receiptId, this.sessionId, this.mandateId, JSON.stringify(receipt), Math.floor(Date.now() / 1_000)],
    );
  }

  async clearPending(receiptId: string): Promise<void> {
    const client = await initialize();
    if (!client) {
      memory.__ackrateReceipts!.delete(receiptId);
      return;
    }
    await client.query(
      `DELETE FROM ackrate_payment_receipts WHERE receipt_id = $1 AND session_id = $2 AND mandate_id = $3`,
      [receiptId, this.sessionId, this.mandateId],
    );
  }

  async listPending(): Promise<ReadonlyArray<Readonly<SettlementReceipt>>> {
    const client = await initialize();
    if (!client) {
      return [...memory.__ackrateReceipts!.values()].filter((receipt) => receipt.mandateId === this.mandateId);
    }
    const rows = await client.query(
      `SELECT receipt FROM ackrate_payment_receipts WHERE session_id = $1 AND mandate_id = $2 ORDER BY created_at ASC`,
      [this.sessionId, this.mandateId],
    );
    return rows.map((row) => (row as { receipt: SettlementReceipt }).receipt);
  }
}
