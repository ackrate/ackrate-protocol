import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { isStellarSigner, keypairSigner, stellarSigner } from "./signer.js";

test("normalizes a user-controlled wallet without requiring a secret", () => {
  const publicKey = Keypair.random().publicKey();
  const wallet = {
    publicKey,
    async signTransaction(xdr: string) {
      return { signedTxXdr: xdr, signerAddress: publicKey };
    },
  };

  assert.equal(isStellarSigner(wallet), true);
  assert.equal(stellarSigner(wallet, Networks.TESTNET), wallet);
  assert.equal("keypair" in stellarSigner(wallet, Networks.TESTNET), false);
});

test("rejects malformed wallet signer shapes", () => {
  assert.equal(isStellarSigner({ publicKey: "G-not-an-address", signTransaction() {} }), false);
  assert.equal(isStellarSigner({ publicKey: Keypair.random().publicKey() }), false);
});

test("keeps local keypairs as a test and server-only compatibility path", () => {
  const keypair = Keypair.random();
  const signer = keypairSigner(keypair, Networks.TESTNET);
  assert.equal(signer.publicKey, keypair.publicKey());
  assert.equal(typeof signer.signTransaction, "function");
  assert.equal(typeof signer.signAuthEntry, "function");
});
