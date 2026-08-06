import assert from "node:assert/strict";
import test from "node:test";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  combineSignedEnvelopes,
  createSigningRequest,
  verifySigningRequest,
  type AuthorityManifest,
} from "./ops-signing-request.js";

const A = Keypair.random();
const B = Keypair.random();
const C = Keypair.random();
const D = Keypair.random();
const target = Address.contract(Buffer.alloc(32, 7)).toString();

function manifest(
  signers: [Keypair, Keypair, Keypair] = [A, B, C],
): AuthorityManifest {
  return {
    version: 1,
    network: "testnet",
    authorityAccount: A.publicKey(),
    requiredSignatures: 2,
    signers: [
      { label: "A", publicKey: signers[0].publicKey() },
      { label: "B", publicKey: signers[1].publicKey() },
      { label: "C", publicKey: signers[2].publicKey() },
    ],
  };
}

function unsigned(value = 7): string {
  return new TransactionBuilder(new Account(A.publicKey(), "100"), {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 1_700_000_000, maxTime: 1_700_000_300 },
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: target,
        function: "schedule",
        args: [nativeToScVal(value, { type: "u32" })],
      }),
    )
    .build()
    .toXDR();
}

function sign(xdr: string, signer: Keypair): string {
  const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  transaction.sign(signer);
  return transaction.toXDR();
}

test("A+B, A+C, and B+C each assemble exactly two valid signatures", () => {
  const request = createSigningRequest(unsigned(), manifest());
  for (const pair of [
    [A, B],
    [A, C],
    [B, C],
  ] as const) {
    const combined = combineSignedEnvelopes(
      request,
      pair.map((signer) => sign(request.transaction.unsignedEnvelopeXdr, signer)),
    );
    assert.equal(combined.signerPublicKeys.length, 2);
    assert.equal(
      TransactionBuilder.fromXDR(combined.signedEnvelopeXdr, Networks.TESTNET)
        .signatures.length,
      2,
    );
  }
});

test("every single signer fails", () => {
  const request = createSigningRequest(unsigned(), manifest());
  for (const signer of [A, B, C]) {
    assert.throws(
      () => combineSignedEnvelopes(request, [
        sign(request.transaction.unsignedEnvelopeXdr, signer),
      ]),
      /exactly two/,
    );
  }
});

test("unknown, duplicate, removed, and mixed-request signatures fail", () => {
  const request = createSigningRequest(unsigned(), manifest());
  const a = sign(request.transaction.unsignedEnvelopeXdr, A);
  const b = sign(request.transaction.unsignedEnvelopeXdr, B);
  const unknown = sign(request.transaction.unsignedEnvelopeXdr, D);

  assert.throws(() => combineSignedEnvelopes(request, [a, unknown]), /unknown/);
  assert.throws(() => combineSignedEnvelopes(request, [a, a]), /duplicate/);

  const removedB = createSigningRequest(unsigned(), manifest([A, D, C]));
  assert.throws(
    () => combineSignedEnvelopes(removedB, [
      sign(removedB.transaction.unsignedEnvelopeXdr, A),
      sign(removedB.transaction.unsignedEnvelopeXdr, B),
    ]),
    /unknown/,
  );

  const other = createSigningRequest(unsigned(8), manifest());
  assert.throws(
    () => combineSignedEnvelopes(request, [
      a,
      sign(other.transaction.unsignedEnvelopeXdr, B),
    ]),
    /different request/,
  );
  assert.doesNotThrow(() => combineSignedEnvelopes(request, [a, b]));
});

test("changed XDR, effect summary, network, and unknown fields fail closed", () => {
  const request = createSigningRequest(unsigned(), manifest());

  const changedEffect = structuredClone(request);
  changedEffect.transaction.effect.function = "execute";
  assert.throws(() => verifySigningRequest(changedEffect), /does not match/);

  const changedNetwork = structuredClone(request);
  changedNetwork.networkPassphrase = Networks.PUBLIC;
  assert.throws(() => verifySigningRequest(changedNetwork), /passphrase/);

  const unknownField = { ...structuredClone(request), note: "approve this" };
  assert.throws(() => verifySigningRequest(unknownField), /schema/);

  const signedInput = sign(request.transaction.unsignedEnvelopeXdr, A);
  assert.throws(
    () => createSigningRequest(signedInput, manifest()),
    /zero signatures/,
  );
});

test("same request is deterministic and replayed signer input cannot count twice", () => {
  const first = createSigningRequest(unsigned(), manifest());
  const second = createSigningRequest(unsigned(), manifest());
  assert.equal(first.requestId, second.requestId);
  assert.equal(first.transaction.hash, second.transaction.hash);

  const repeated = sign(first.transaction.unsignedEnvelopeXdr, A);
  assert.throws(
    () => combineSignedEnvelopes(first, [repeated, repeated]),
    /duplicate/,
  );
});
