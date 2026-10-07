import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { requireJournalPlatform } from "./journal-platform.js";
import { loadPendingSettlement } from "./settlement-store.js";
import { FileSettlementReceiptStore } from "../../../apps/consumer-agent/src/receipt-store.js";
import { FilePurchaseOutcomeStore } from "../../../apps/consumer-agent/src/outcome-store.js";
import { FileBoundRedemptionStore } from "../../../apps/fulfillment-agent/src/redemption-store.js";

test("unsupported journals fail before creating a directory or operation lock", async () => {
  if (["linux", "darwin", "freebsd", "openbsd", "netbsd"].includes(process.platform)) {
    assert.doesNotThrow(requireJournalPlatform);
    return;
  }
  const previous = process.env.ACKRATE_HOME;
  const directory = join(tmpdir(), `ackrate-platform-${randomUUID()}`);
  process.env.ACKRATE_HOME = directory;
  try {
    await assert.rejects(loadPendingSettlement(), /local POSIX filesystem/);
    for (const Store of [FileSettlementReceiptStore, FilePurchaseOutcomeStore, FileBoundRedemptionStore]) {
      assert.throws(() => new Store(join(directory, "state.json")), /local POSIX filesystem/);
    }
    assert.equal(existsSync(directory), false);
  } finally {
    if (previous === undefined) delete process.env.ACKRATE_HOME;
    else process.env.ACKRATE_HOME = previous;
  }
});
