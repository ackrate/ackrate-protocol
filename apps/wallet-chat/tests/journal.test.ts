import assert from "node:assert/strict";
import test from "node:test";
import { completeToolCall, consumeChallenge, reserveToolCall } from "../lib/journal";

test("authentication challenge can be consumed only once", async () => {
  const jti = crypto.randomUUID().replaceAll("-", "");
  assert.equal(await consumeChallenge(jti, Math.floor(Date.now() / 1_000) + 60), true);
  assert.equal(await consumeChallenge(jti, Math.floor(Date.now() / 1_000) + 60), false);
});

test("tool-call reservation is idempotent and returns the durable result", async () => {
  const sessionId = crypto.randomUUID();
  const toolCallId = crypto.randomUUID();
  const input = { sessionId, toolCallId, mandateId: "a".repeat(64), sourceId: "market-brief" };
  const first = await reserveToolCall(input);
  assert.equal(first.created, true);
  await completeToolCall({ sessionId, toolCallId, status: "succeeded", result: { txHash: "b".repeat(64) } });
  const duplicate = await reserveToolCall(input);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.status, "succeeded");
  assert.deepEqual(duplicate.record.result, { txHash: "b".repeat(64) });
});
