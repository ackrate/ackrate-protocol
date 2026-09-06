import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "buffer";
import { applyRegisteredMandateId, registeredMandateId } from "./registered-id.js";

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
