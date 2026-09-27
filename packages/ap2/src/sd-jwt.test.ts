import assert from "node:assert/strict";
import { sign as rawSign, createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { test } from "node:test";
import {
  type Ap2JsonWebKey as JsonWebKey,
  verifyCompactJws,
  computeSdHash,
  parseSdJwt,
  signCompactJws,
  verifyDelegateSdJwtChain,
} from "./sd-jwt.js";

function p256(): { privateKey: KeyObject; publicJwk: JsonWebKey } {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: pair.privateKey,
    publicJwk: pair.publicKey.export({ format: "jwk" }),
  };
}

function ed25519(): { privateKey: KeyObject; publicJwk: JsonWebKey } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicJwk: pair.publicKey.export({ format: "jwk" }),
  };
}

function sdJwt(
  payload: Readonly<Record<string, unknown>>,
  key: KeyObject,
  alg: "ES256" | "EdDSA" = "ES256",
  typ?: string,
  disclosures: readonly string[] = [],
): string {
  const jwt = signCompactJws(payload, { alg, key, ...(typ ? { typ } : {}) });
  return `${jwt}~${disclosures.length > 0 ? `${disclosures.join("~")}~` : ""}`;
}

function append(...segments: readonly string[]): string {
  return segments.map((segment, index) =>
    index < segments.length - 1 && segment.endsWith("~") ? segment.slice(0, -1) : segment
  ).join("~~");
}

test("verifies AP2 root -> intermediate -> terminal Delegate SD-JWT chains", async () => {
  const user = p256();
  const shoppingAgent = p256();
  const credentialProvider = p256();
  const now = 1_800_000_000;

  const root = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.open.1",
      constraints: [],
      cnf: { jwk: shoppingAgent.publicJwk },
      exp: now + 600,
    }],
    _sd_alg: "sha-256",
  }, user.privateKey);
  const middle = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.open.1",
      constraints: [],
      cnf: { jwk: credentialProvider.publicJwk },
    }],
    iat: now,
    aud: "credential-provider",
    nonce: "cp-nonce",
    sd_hash: computeSdHash(parseSdJwt(root)),
  }, shoppingAgent.privateKey, "ES256", "kb+sd-jwt+kb");
  const terminal = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.1",
      transaction_id: "checkout-hash",
    }],
    iat: now,
    aud: "merchant.example",
    nonce: "merchant-nonce",
    sd_hash: computeSdHash(parseSdJwt(middle)),
  }, credentialProvider.privateKey, "ES256", "kb+sd-jwt");

  const verified = await verifyDelegateSdJwtChain(append(root, middle, terminal), {
    resolveRootKey: () => user.publicJwk,
    expectedAudience: "merchant.example",
    expectedNonce: "merchant-nonce",
    currentTime: now,
  });

  assert.equal(verified.hops.length, 3);
  assert.equal(verified.payloads[0]!.vct, "mandate.payment.open.1");
  assert.equal(verified.payloads[2]!.vct, "mandate.payment.1");
  assert.equal(verified.rootSdHash, computeSdHash(parseSdJwt(root)));
  assert.equal(verified.leafSdHash, computeSdHash(parseSdJwt(terminal)));
});

test("resolves selectively disclosed delegate payloads and Ed25519 key binding", async () => {
  const user = ed25519();
  const agent = ed25519();
  const now = 1_800_000_000;
  const open = {
    vct: "mandate.checkout.open.1",
    constraints: [{ type: "checkout.line_items", items: [] }],
    cnf: { jwk: agent.publicJwk },
  };
  const disclosure = Buffer.from(JSON.stringify(["salt-1", open]), "utf8").toString("base64url");
  const digest = createHash("sha256").update(disclosure, "ascii").digest("base64url");
  const root = sdJwt({
    delegate_payload: [digest],
    _sd_alg: "sha-256",
  }, user.privateKey, "EdDSA", undefined, [disclosure]);
  const terminal = sdJwt({
    delegate_payload: [{
      vct: "mandate.checkout.1",
      checkout_jwt: "header.payload.signature",
      checkout_hash: "hash",
    }],
    iat: now,
    aud: "merchant",
    nonce: "nonce",
    issuer_jwt_hash: createHash("sha256")
      .update(parseSdJwt(root).issuerJwt, "ascii")
      .digest("base64url"),
  }, agent.privateKey, "EdDSA", "kb-sd-jwt");

  const verified = await verifyDelegateSdJwtChain(append(root, terminal), {
    resolveRootKey: () => user.publicJwk,
    expectedAudience: "merchant",
    expectedNonce: "nonce",
    currentTime: now,
  });
  assert.equal(verified.payloads[0]!.vct, "mandate.checkout.open.1");
  assert.equal(verified.payloads[1]!.vct, "mandate.checkout.1");
});

test("rejects a wrong terminal challenge and altered predecessor binding", async () => {
  const user = p256();
  const agent = p256();
  const now = 1_800_000_000;
  const root = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.open.1",
      constraints: [],
      cnf: { jwk: agent.publicJwk },
    }],
  }, user.privateKey);
  const terminal = sdJwt({
    delegate_payload: [{ vct: "mandate.payment.1" }],
    iat: now,
    aud: "merchant",
    nonce: "nonce",
    sd_hash: "not-the-root-hash",
  }, agent.privateKey, "ES256", "kb+sd-jwt");

  await assert.rejects(
    verifyDelegateSdJwtChain(append(root, terminal), {
      resolveRootKey: () => user.publicJwk,
      expectedAudience: "merchant",
      expectedNonce: "wrong",
      currentTime: now,
    }),
    /sd_hash does not match/,
  );
});

test("rejects unbound disclosures and unsupported algorithms", async () => {
  const user = p256();
  const unbound = Buffer.from(JSON.stringify(["salt", "unused", true]), "utf8").toString("base64url");
  const root = sdJwt({
    delegate_payload: [{
      vct: "mandate.payment.open.1",
      constraints: [],
      cnf: { jwk: user.publicJwk },
    }],
  }, user.privateKey, "ES256", undefined, [unbound]);

  // minHops: 1 keeps this case about disclosure binding rather than hop count.
  await assert.rejects(
    verifyDelegateSdJwtChain(root, { resolveRootKey: () => user.publicJwk, minHops: 1 }),
    /unbound disclosure/,
  );
});

test("a one-hop presentation is refused by default", async () => {
  const user = p256();
  const now = 1_800_000_000;
  const root = sdJwt({
    delegate_payload: [{ vct: "mandate.payment.open.1", constraints: [], exp: now + 600 }],
  }, user.privateKey);

  await assert.rejects(
    verifyDelegateSdJwtChain(root, { resolveRootKey: () => user.publicJwk, currentTime: now }),
    /chain must contain at least 2 hops/,
  );
});

test("a one-hop presentation still has its audience and nonce checked", async () => {
  const user = p256();
  const now = 1_800_000_000;
  const root = sdJwt({
    delegate_payload: [{ vct: "mandate.payment.open.1", constraints: [], exp: now + 600 }],
    aud: "SOME-OTHER-MERCHANT",
    nonce: "STALE",
  }, user.privateKey);

  await assert.rejects(
    verifyDelegateSdJwtChain(root, {
      resolveRootKey: () => user.publicJwk,
      currentTime: now,
      minHops: 1,
      expectedAudience: "THE-REAL-MERCHANT",
    }),
    /terminal aud does not match/,
  );
  await assert.rejects(
    verifyDelegateSdJwtChain(root, {
      resolveRootKey: () => user.publicJwk,
      currentTime: now,
      minHops: 1,
      expectedNonce: "FRESH",
    }),
    /terminal nonce does not match/,
  );
});

test("minHops must be a sane bound", async () => {
  const user = p256();
  const root = sdJwt({ vct: "x" }, user.privateKey);
  await assert.rejects(
    verifyDelegateSdJwtChain(root, { resolveRootKey: () => user.publicJwk, minHops: 0 }),
    /minHops must be a safe integer/,
  );
  await assert.rejects(
    verifyDelegateSdJwtChain(root, { resolveRootKey: () => user.publicJwk, minHops: 9 }),
    /minHops must be a safe integer/,
  );
});

function rawJws(header: Record<string, unknown>, key: KeyObject): string {
  const input = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from('{}').toString("base64url")}`;
  return `${input}.${rawSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

test("rejects cryptographically valid JWS with unsupported critical headers", () => {
  const pair = p256();
  for (const additional of [{ crit: ["custom"], custom: true }, { crit: [] }, { b64: false }, { b64: true }]) {
    const jwt = rawJws({ alg: "ES256", ...additional }, pair.privateKey);
    assert.throws(() => verifyCompactJws(jwt, pair.publicJwk), /unsupported JWS/);
    assert.throws(() => parseSdJwt(`${jwt}~`), /unsupported JWS/);
    assert.throws(() => signCompactJws({}, { alg: "ES256", key: pair.privateKey, additionalHeader: additional }), /unsupported JWS/);
  }
});

test("rejects ES256 signatures made using secp256k1 even when signature verifies mathematically", () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  assert.throws(() => verifyCompactJws(rawJws({ alg: "ES256" }, pair.privateKey), pair.publicKey), /P-256/);
  assert.throws(() => signCompactJws({}, { alg: "ES256", key: pair.privateKey }), /P-256/);
});

test("binds algorithm and permitted operation to JWK metadata", () => {
  const pair = p256();
  const jwt = signCompactJws({}, { alg: "ES256", key: pair.privateKey });
  for (const metadata of [{ alg: "ES384" }, { use: "enc" }, { key_ops: ["sign"] }]) {
    assert.throws(() => verifyCompactJws(jwt, { ...pair.publicJwk, ...metadata }), /JWK/);
  }
  const ed = ed25519();
  assert.throws(() => verifyCompactJws(jwt, ed.publicJwk), /P-256/);
  const edJwt = signCompactJws({}, { alg: "EdDSA", key: ed.privateKey });
  assert.equal(verifyCompactJws(edJwt, ed.publicJwk).header.alg, "EdDSA");
  assert.throws(() => verifyCompactJws(edJwt, pair.publicJwk), /Ed25519/);
});

test("withheld mandate disclosures never fall back to the outer payload", async () => {
  const rootKey = ed25519();
  const next = ed25519();
  const disclosure = Buffer.from(JSON.stringify(["salt", { constraints: [{ max: "1" }], cnf: { jwk: next.publicJwk } }])).toString("base64url");
  const digest = createHash("sha256").update(disclosure).digest("base64url");
  for (const delegate_payload of [[], [digest], [{ "...": digest }], [{ constraints: [] }, { "...": digest }]]) {
    const root = sdJwt({ delegate_payload, cnf: { jwk: next.publicJwk } }, rootKey.privateKey, "EdDSA");
    await assert.rejects(verifyDelegateSdJwtChain(root, { minHops: 1, resolveRootKey: () => rootKey.publicJwk }), /delegate_payload/);
  }
});

test("ES256 signer emits low-S signatures and verifier rejects their high-S twins", () => {
  const pair = p256();
  const jwt = signCompactJws({}, { alg: "ES256", key: pair.privateKey });
  assert.equal(verifyCompactJws(jwt, pair.publicJwk).header.alg, "ES256");
  const parts = jwt.split(".");
  const signature = Buffer.from(parts[2]!, "base64url");
  const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const scalar = BigInt(`0x${signature.subarray(32).toString("hex")}`);
  assert.ok(scalar <= order / 2n);
  Buffer.from((order - scalar).toString(16).padStart(64, "0"), "hex").copy(signature, 32);
  parts[2] = signature.toString("base64url");
  assert.throws(() => verifyCompactJws(parts.join("."), pair.publicJwk), /low-S/);
});

test("resolved prototype-named claims remain visible own data properties", async () => {
  const pair = ed25519();
  const payload = JSON.parse('{"__proto__":{"limits":{"max_amount":"5"}}}') as Record<string, unknown>;
  const jwt = sdJwt(payload, pair.privateKey, "EdDSA");
  const verified = await verifyDelegateSdJwtChain(jwt, { minHops: 1, resolveRootKey: () => pair.publicJwk });
  const resolved = verified.payloads[0]!;
  assert.deepEqual(Object.keys(resolved), ["__proto__"]);
  assert.equal(resolved.limits, undefined);
  assert.equal(Object.getPrototypeOf(resolved), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), payload);
});

test("text hashes distinguish UTF-8 text and timestamps fail at expiry or before nbf", async () => {
  const { hashAp2Text } = await import("./sd-jwt.js");
  assert.notEqual(hashAp2Text("€5"), hashAp2Text("¬5"));
  const pair = ed25519();
  for (const payload of [{ exp: 100 }, { nbf: 101 }]) {
    await assert.rejects(verifyDelegateSdJwtChain(sdJwt(payload, pair.privateKey, "EdDSA"), {
      minHops: 1, resolveRootKey: () => pair.publicJwk, currentTime: 100, clockSkewSeconds: 0,
    }));
  }
});
