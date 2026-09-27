import assert from "node:assert/strict";
import test from "node:test";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createChallengeToken, createSessionToken, openToken, sealToken, verifySignedChallengeTransaction } from "../lib/security";

const binding = { network: "testnet" as const, profileFingerprint: "a".repeat(64) };
const secret = "test-session-secret-with-at-least-32-bytes";

test("signed session tokens verify only for the requested kind", () => {
  const { token, payload } = createSessionToken("GTEST", binding, secret, 1_000);
  assert.equal(openToken(token, secret, "session", binding, 1_001)?.jti, payload.jti);
  assert.equal(openToken(token, secret, "challenge", binding, 1_001), null);
});

test("token tampering and expiry fail closed", () => {
  const { token } = createSessionToken("GTEST", binding, secret, 1_000);
  const [body, signature] = token.split(".");
  const replacement = body[0] === "A" ? "B" : "A";
  assert.equal(openToken(`${replacement}${body.slice(1)}.${signature}`, secret, "session", binding, 1_001), null);
  assert.equal(openToken(token, `${secret}!`, "session", binding, 1_001), null);
  assert.equal(openToken(token, secret, "session", binding, 4_601), null);
});

test("sessions and challenges cannot cross profile fingerprints or networks, even with a shared test secret", () => {
  for (const kind of ["session", "challenge"] as const) {
    const issued = kind === "session" ? createSessionToken("GTEST", binding, secret, 1_000)
      : createChallengeToken("GTEST", binding, "b".repeat(64), secret, 1_000);
    assert.ok(openToken(issued.token, secret, kind, binding, 1_001));
    assert.equal(openToken(issued.token, secret, kind, { ...binding, network: "mainnet" }, 1_001), null);
    assert.equal(openToken(issued.token, secret, kind, { ...binding, profileFingerprint: "c".repeat(64) }, 1_001), null);
    const legacy = { ...issued.payload, v: 1 } as unknown as Parameters<typeof sealToken>[0];
    assert.equal(openToken(sealToken(legacy, secret), secret, kind, binding, 1_001), null);
  }
});

test("challenge binds the account, network, and exact transaction hash", () => {
  const txHash = "a".repeat(64);
  const { token } = createChallengeToken("GTEST", { ...binding, network: "mainnet" }, txHash, secret, 2_000);
  const opened = openToken(token, secret, "challenge", { ...binding, network: "mainnet" }, 2_001);
  assert.equal(opened?.address, "GTEST");
  assert.equal(opened?.network, "mainnet");
  assert.equal(opened?.txHash, txHash);
});

test("authentication accepts only the exact transaction signed by the expected account", () => {
  const expected = Keypair.random();
  const rogue = Keypair.random();
  const unsigned = new TransactionBuilder(new Account(expected.publicKey(), "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.manageData({ name: "ackrate.auth.v1", value: Buffer.alloc(16, 7) }))
    .setTimebounds(1_000, 1_300)
    .build();
  const hash = unsigned.hash().toString("hex");
  unsigned.sign(expected);
  assert.doesNotThrow(() => verifySignedChallengeTransaction(unsigned.toXDR(), Networks.TESTNET, expected.publicKey(), hash));

  const rogueSigned = new TransactionBuilder(new Account(expected.publicKey(), "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.manageData({ name: "ackrate.auth.v1", value: Buffer.alloc(16, 7) }))
    .setTimebounds(1_000, 1_300)
    .build();
  rogueSigned.sign(rogue);
  assert.throws(() => verifySignedChallengeTransaction(rogueSigned.toXDR(), Networks.TESTNET, expected.publicKey(), hash), /could not be verified/);
  assert.throws(() => verifySignedChallengeTransaction(unsigned.toXDR(), Networks.PUBLIC, expected.publicKey(), hash), /does not match/);
});
