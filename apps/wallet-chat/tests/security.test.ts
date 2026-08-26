import assert from "node:assert/strict";
import test from "node:test";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createChallengeToken, createSessionToken, openToken, verifySignedChallengeTransaction } from "../lib/security";

const secret = "test-session-secret-with-at-least-32-bytes";

test("signed session tokens verify only for the requested kind", () => {
  const { token, payload } = createSessionToken("GTEST", "testnet", secret, 1_000);
  assert.equal(openToken(token, secret, "session", 1_001)?.jti, payload.jti);
  assert.equal(openToken(token, secret, "challenge", 1_001), null);
});

test("token tampering and expiry fail closed", () => {
  const { token } = createSessionToken("GTEST", "testnet", secret, 1_000);
  const [body, signature] = token.split(".");
  const replacement = body[0] === "A" ? "B" : "A";
  assert.equal(openToken(`${replacement}${body.slice(1)}.${signature}`, secret, "session", 1_001), null);
  assert.equal(openToken(token, `${secret}!`, "session", 1_001), null);
  assert.equal(openToken(token, secret, "session", 4_601), null);
});

test("challenge binds the account, network, and exact transaction hash", () => {
  const txHash = "a".repeat(64);
  const { token } = createChallengeToken("GTEST", "mainnet", txHash, secret, 2_000);
  const opened = openToken(token, secret, "challenge", 2_001);
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
