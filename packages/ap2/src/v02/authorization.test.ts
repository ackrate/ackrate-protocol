import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import {
  captureAuthorizationId,
  poolParticipationAuthorizationId,
  signAp2CaptureAuthorization,
  signAp2PoolParticipationAuthorization,
  stellarNetworkId,
  type Ap2CaptureAuthorization,
  type Ap2PoolParticipationAuthorization,
} from "./authorization.js";

const verifier = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const addresses = [
  "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR",
  "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U",
  "GDWUSKGGFDI4FRXK5EBTRECZSVQSSWJHHJOGH6JWG3AUMFFMQ435DIAG",
  "GDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HZDQP",
] as const;

function capture(): Ap2CaptureAuthorization {
  return {
    version: 1,
    networkId: "09".repeat(32),
    registry: addresses[0],
    kind: "Simple",
    mandateId: "01".repeat(32),
    agent: addresses[1],
    merchant: addresses[2],
    asset: addresses[3],
    amount: 100n,
    expectedSeq: 0,
    openCheckoutEvidence: "02".repeat(32),
    closedCheckoutEvidence: "03".repeat(32),
    openPaymentEvidence: "04".repeat(32),
    closedPaymentEvidence: "05".repeat(32),
    nonce: "06".repeat(32),
    verifierKey: verifier.rawPublicKey().toString("hex"),
    notBefore: 1_799_999_999,
    expiresAt: 1_800_000_600,
  };
}

test("capture authorization ID matches the Soroban contract vector", () => {
  const authorization = capture();
  const id = captureAuthorizationId(authorization);
  assert.equal(id, "8993a72430d4f600f151b0fafd8ab24a15cf0664306512303df3b7d97d239663");

  const signed = signAp2CaptureAuthorization(authorization, verifier);
  assert.equal(signed.authorizationId, id);
  assert.equal(Buffer.from(signed.signature, "hex").length, 64);
  assert(verifier.verify(Buffer.from(id, "hex"), Buffer.from(signed.signature, "hex")));
});

test("authorization IDs are route-specific and network-bound", () => {
  const authorization = capture();
  assert.notEqual(
    captureAuthorizationId({ ...authorization, kind: "CompositeSolo" }),
    captureAuthorizationId(authorization),
  );
  assert.notEqual(
    captureAuthorizationId({ ...authorization, registry: addresses[1] }),
    captureAuthorizationId(authorization),
  );
  assert.notEqual(
    stellarNetworkId(Networks.TESTNET),
    stellarNetworkId(Networks.PUBLIC),
  );
});

function participation(): Ap2PoolParticipationAuthorization {
  return {
    version: 1,
    networkId: "09".repeat(32),
    registry: addresses[0],
    poolId: "10".repeat(32),
    mandateId: "11".repeat(32),
    agent: addresses[1],
    merchant: addresses[2],
    asset: addresses[3],
    maxAmount: 500n,
    scheduleHash: "12".repeat(32),
    openCheckoutEvidence: "13".repeat(32),
    closedCheckoutEvidence: "14".repeat(32),
    openParticipationEvidence: "15".repeat(32),
    closedParticipationEvidence: "16".repeat(32),
    nonce: "17".repeat(32),
    verifierKey: verifier.rawPublicKey().toString("hex"),
    notBefore: 1_799_999_999,
    expiresAt: 1_800_000_600,
  };
}

test("pool participation authorization ID matches the Soroban contract vector", () => {
  // Pinned against `participation_id` in the AP2 extension's Rust test suite.
  // Without this, a field reorder or rename on either side would silently make
  // every on-chain pool participation signature unverifiable, and no pooled
  // test would notice: the Rust pool tests sign in Rust, not from this code.
  assert.equal(
    poolParticipationAuthorizationId(participation()),
    "8627f68f4eddba96b24e262b7f7d9d3b13d0e96ddf8fdf6711230474666b9165",
  );
});

test("pool participation authorizations have a separate domain and signature", () => {
  const authorization = participation();
  const signed = signAp2PoolParticipationAuthorization(authorization, verifier);
  assert.equal(signed.authorizationId, poolParticipationAuthorizationId(authorization));
  assert.notEqual(signed.authorizationId, captureAuthorizationId(capture()));
  assert(verifier.verify(
    Buffer.from(signed.authorizationId, "hex"),
    Buffer.from(signed.signature, "hex"),
  ));
});

test("every authorization field changes its ID", () => {
  const base = participation();
  const baseId = poolParticipationAuthorizationId(base);
  const variants: Partial<Ap2PoolParticipationAuthorization>[] = [
    { poolId: "ff".repeat(32) },
    { mandateId: "fe".repeat(32) },
    { agent: addresses[2] },
    { merchant: addresses[1] },
    { asset: addresses[0] },
    { maxAmount: 501n },
    { scheduleHash: "fd".repeat(32) },
    { openCheckoutEvidence: "fc".repeat(32) },
    { closedCheckoutEvidence: "fb".repeat(32) },
    { openParticipationEvidence: "fa".repeat(32) },
    { closedParticipationEvidence: "f9".repeat(32) },
    { nonce: "f8".repeat(32) },
    { networkId: "f7".repeat(32) },
    { notBefore: 1_799_999_998 },
    { expiresAt: 1_800_000_601 },
  ];
  for (const variant of variants) {
    assert.notEqual(
      poolParticipationAuthorizationId({ ...base, ...variant }),
      baseId,
      `${Object.keys(variant)[0]} must be covered by the authorization ID`,
    );
  }
});
