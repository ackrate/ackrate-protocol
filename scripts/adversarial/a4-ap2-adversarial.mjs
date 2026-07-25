// Gate A4 — adversarial validation of the @reapp-sdk/ap2 validator. Every
// mutation of a validly signed AP2 credential must fail closed, for BOTH the
// v0.1 IntentMandate profile and the v0.2 Open Payment Mandate profile.
//
// Run as-is this attacks the WORKSPACE package. To attack the published one,
// copy this file into an empty directory and install from the registry — see
// the install line in ./README.md.
//
// Two rules keep this gate honest:
//   1. A rejection only counts if it came from the validator as an
//      Ap2ValidationError with an expected code. A credential that never got
//      minted, or a TypeError from a renamed export, is a FAIL — that is how
//      this file silently rotted when the package moved to v0.2.
//   2. Refusals at signing time are asserted separately from refusals at
//      admission time, because they protect different parties.
import {
  Ap2ValidationError,
  InMemoryAp2ReplayStore,
  canonicalizeJson,
  createAp2ComplianceValidator,
  signAp2Mandate,
  signAp2V01Mandate,
} from "@reapp-sdk/ap2";
import { reapp } from "@reapp-sdk/core";
import { Keypair, hash } from "@stellar/stellar-sdk";

const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

const USER = Keypair.random();
const AGENT = Keypair.random();
const MERCHANT = Keypair.random().publicKey();
const OTHER_MERCHANT = Keypair.random().publicKey();
const CHECKOUT = "a4-checkout-reference";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const utc = (unix) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");

function freshValidator(now) {
  return createAp2ComplianceValidator({
    replayStore: new InMemoryAp2ReplayStore(),
    replayNamespace: `stellar-testnet:${reapp.testnet.mandateRegistryId}`,
    ...(now ? { now } : {}),
  });
}

/**
 * The signing digest, reimplemented from the documented construction rather
 * than imported. A real attacker holding a user key does not call our signer,
 * so neither does this file: it forges credentials the package would refuse to
 * produce and checks the validator rejects them anyway.
 *
 * Reimplementing it also means the control case below independently confirms
 * the package's scheme matches what its README documents.
 */
function forgeSignature(domain, credentialVersion, versionFields, payload, mandateHash, signer) {
  const parts = [Buffer.from(domain, "utf8"), Buffer.from(credentialVersion, "utf8"), Buffer.from([0])];
  for (const field of versionFields) {
    parts.push(Buffer.from(payload[field], "utf8"), Buffer.from([0]));
  }
  parts.push(
    hash(Buffer.from(canonicalizeJson(payload), "utf8")),
    Buffer.from([0]),
    Buffer.from(mandateHash, "hex"),
  );
  return signer.sign(hash(Buffer.concat(parts))).toString("base64");
}

/* --------------------------------------------------------------------------
 * The two profiles under test. Each knows how to mint its own credential and
 * how to reach the fields an attacker would target, so the 12 shared checks
 * below are written once and run twice.
 * ------------------------------------------------------------------------ */

const v01 = {
  label: "v0.1",
  baseArgs: { expectedUser: USER.publicKey(), merchant: MERCHANT, amount: "1.00" },
  mint({ expiry = nowSeconds() + 3600, merchants = [MERCHANT], signer = USER, intent = {}, stellar = {} } = {}) {
    return signAp2V01Mandate({
      intent: {
        user_cart_confirmation_required: false,
        natural_language_description: "Buy one research dataset",
        merchants,
        intent_expiry: utc(expiry),
        ...intent,
      },
      stellar: {
        user: USER.publicKey(),
        agent: AGENT.publicKey(),
        asset: reapp.testnet.nativeSac,
        maxAmount: "5.00",
        ...stellar,
      },
    }, signer);
  },
  escalateBudget(credential) {
    credential.payload.stellar.maxAmount = "500.00";
  },
  widenPayees(credential) {
    credential.payload.intent.merchants = [MERCHANT, OTHER_MERCHANT];
  },
  foreignCredentialVersion: "reapp-ap2-credential/2",
  unsupportedSemantics: [
    ["cart-confirmation required", { intent: { user_cart_confirmation_required: true } }, /user_cart_confirmation_required=false/],
    ["refundability required", { intent: { requires_refundability: true } }, /requires_refundability=true is not supported/],
    ["SKU-scoped intent", { intent: { skus: ["sku-1"] } }, /intent\.skus is not supported/],
    ["multi-merchant intent", { merchants: [MERCHANT, OTHER_MERCHANT] }, /exactly one Stellar merchant address/],
  ],
  /** Re-sign a payload the package itself would never emit, using the real user key. */
  forge(mutate) {
    const credential = structuredClone(this.mint());
    mutate(credential.payload);
    credential.signature.value = forgeSignature(
      "REAPP\0AP2\0SIGNED-MANDATE\0V1\0",
      credential.credentialVersion,
      ["ap2SpecVersion", "ap2DataKey", "bindingVersion"],
      credential.payload,
      credential.mandateHash,
      USER,
    );
    return credential;
  },
  forgeUnsupported(payload) {
    // With a valid signature over this exact payload, the only thing left to
    // reject it is the v0.1 schema rule itself.
    payload.intent.user_cart_confirmation_required = true;
  },
};

const v02 = {
  label: "v0.2",
  baseArgs: {
    expectedUser: USER.publicKey(),
    merchant: MERCHANT,
    amount: "1.00",
    checkoutReference: CHECKOUT,
  },
  mint({ expiry = nowSeconds() + 3600, payees, signer = USER, constraints = {}, cnf } = {}) {
    const allowed = payees ?? [{ id: MERCHANT, name: "Dataset Co" }];
    return signAp2Mandate({
      paymentMandate: {
        vct: "mandate.payment.open.1",
        constraints: [
          { type: "payment.allowed_payees", allowed },
          { type: "payment.amount_range", currency: "USD", max: 500, ...constraints.amount_range },
          { type: "payment.agent_recurrence", frequency: "ON_DEMAND", ...constraints.agent_recurrence },
          { type: "payment.budget", max: 5, currency: "USD", ...constraints.budget },
          { type: "payment.execution_date", not_after: utc(expiry), ...constraints.execution_date },
          { type: "payment.reference", conditional_transaction_id: CHECKOUT },
        ],
        cnf: cnf ?? {
          jwk: {
            kty: "OKP",
            crv: "Ed25519",
            x: Buffer.from(AGENT.rawPublicKey()).toString("base64url"),
          },
        },
        exp: expiry,
      },
      stellar: {
        user: USER.publicKey(),
        agent: AGENT.publicKey(),
        asset: reapp.testnet.nativeSac,
      },
    }, signer);
  },
  escalateBudget(credential) {
    const constraints = credential.payload.paymentMandate.constraints;
    constraints.find((c) => c.type === "payment.amount_range").max = 50_000;
    constraints.find((c) => c.type === "payment.budget").max = 500;
  },
  widenPayees(credential) {
    credential.payload.paymentMandate.constraints
      .find((c) => c.type === "payment.allowed_payees")
      .allowed.push({ id: OTHER_MERCHANT, name: "Somebody Else" });
  },
  foreignCredentialVersion: "reapp-ap2-credential/1",
  unsupportedSemantics: [
    ["bounded recurrence", { constraints: { agent_recurrence: { max_occurrences: 3 } } }, /ON_DEMAND without max_occurrences/],
    ["minimum payment amount", { constraints: { amount_range: { min: 1 } } }, /amount_range\.min is unsupported/],
    ["not-before execution window", { constraints: { execution_date: { not_before: utc(nowSeconds() + 60) } } }, /not_before is unsupported/],
    ["multi-payee scope", { payees: [{ id: MERCHANT, name: "A" }, { id: OTHER_MERCHANT, name: "B" }] }, /exactly one Stellar merchant/],
    ["confirmation key that is not the agent", {
      cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: Buffer.from(Keypair.random().rawPublicKey()).toString("base64url") } },
    }, /cnf must contain the Ed25519 JWK/],
  ],
  forge(mutate) {
    const credential = structuredClone(this.mint());
    mutate(credential.payload);
    credential.signature.value = forgeSignature(
      "REAPP\0AP2\0SIGNED-MANDATE\0V2\0",
      credential.credentialVersion,
      ["ap2SpecVersion", "ap2Vct", "bindingVersion"],
      credential.payload,
      credential.mandateHash,
      USER,
    );
    return credential;
  },
  forgeUnsupported(payload) {
    payload.paymentMandate.constraints.find((c) => c.type === "payment.amount_range").min = 1;
  },
};

/* --------------------------------------------------------------------------
 * Assertions.
 * ------------------------------------------------------------------------ */

/**
 * The credential is built OUTSIDE the try block on purpose. If minting throws,
 * this reports FAIL rather than counting the mint failure as a fail-closed win.
 */
async function mustRejectAtAdmission(name, build, admit, expectedCodes) {
  let credential;
  try {
    credential = build();
  } catch (err) {
    record(name, false, `could not mint the credential under test: ${err?.message ?? err}`);
    return;
  }
  try {
    await admit(credential);
    record(name, false, "validator unexpectedly admitted");
  } catch (err) {
    if (!(err instanceof Ap2ValidationError)) {
      record(name, false, `rejected, but not by the validator: ${err?.message ?? err}`);
      return;
    }
    if (!expectedCodes.includes(err.code)) {
      record(name, false, `rejected with unexpected code ${err.code}`);
      return;
    }
    record(name, true, err.code);
  }
}

/**
 * `expected` is required. Accepting any throw is how the previous version of
 * this file scored its own crashes as wins — a profile-specific TypeError or a
 * malformed fixture must not read as a refusal.
 */
function mustRefuseAtSigning(name, mint, expected) {
  try {
    mint();
    record(name, false, "package minted a credential it cannot enforce");
  } catch (err) {
    const message = String(err?.message ?? err);
    if (!(err instanceof Error) || !expected.test(message)) {
      record(name, false, `threw, but not the expected refusal: ${message.slice(0, 90)}`);
      return;
    }
    record(name, true, message.slice(0, 100));
  }
}

/* --------------------------------------------------------------------------
 * The shared suite, run once per profile.
 * ------------------------------------------------------------------------ */

for (const profile of [v01, v02]) {
  const tag = `[${profile.label}]`;
  const args = profile.baseArgs;
  const admit = (overrides = {}) => (credential) =>
    freshValidator(overrides.now).validateAndConsume({ credential, ...args, ...overrides.args });

  // 1. valid credential admits
  {
    let detail = "";
    let ok = false;
    try {
      const accepted = await freshValidator().validateAndConsume({ credential: profile.mint(), ...args });
      ok = !!accepted?.binding?.mandate?.id;
      detail = `mandate=${accepted?.binding?.mandate?.id?.slice(0, 12)}…`;
    } catch (err) {
      detail = `validator rejected a valid credential: ${err?.message ?? err}`;
    }
    record(`${tag} valid signed mandate admits and yields on-chain binding`, ok, detail);
  }

  // 2. altered signature byte — well-formed base64, one bit flipped
  await mustRejectAtAdmission(`${tag} tampered signature (one flipped bit) fails closed`, () => {
    const credential = structuredClone(profile.mint());
    const signature = Buffer.from(credential.signature.value, "base64");
    signature[0] ^= 0x01;
    credential.signature = { ...credential.signature, value: signature.toString("base64") };
    return credential;
  }, admit(), ["INVALID_SIGNATURE"]);

  // 3. payload mutation after signing (budget escalation, signature untouched)
  await mustRejectAtAdmission(`${tag} payload budget escalated after signing fails closed`, () => {
    const credential = structuredClone(profile.mint());
    profile.escalateBudget(credential);
    return credential;
  }, admit(), ["BINDING_MISMATCH", "INVALID_SIGNATURE", "INVALID_CREDENTIAL"]);

  // 3b. mandateHash swapped for another observed credential's, signature untouched
  await mustRejectAtAdmission(`${tag} swapped mandate hash with mutated payload fails closed`, () => {
    const credential = structuredClone(profile.mint());
    profile.escalateBudget(credential);
    credential.mandateHash = profile.mint().mandateHash;
    return credential;
  }, admit(), ["BINDING_MISMATCH", "INVALID_SIGNATURE", "INVALID_CREDENTIAL"]);

  // 4. wrong merchant at admission
  await mustRejectAtAdmission(
    `${tag} merchant outside mandate scope fails closed`,
    () => profile.mint(),
    admit({ args: { merchant: OTHER_MERCHANT } }),
    ["MERCHANT_MISMATCH"],
  );

  // 5. amount above the signed budget
  await mustRejectAtAdmission(
    `${tag} admission amount above signed budget fails closed`,
    () => profile.mint(),
    admit({ args: { amount: "6.00" } }),
    ["AMOUNT_EXCEEDS_MANDATE"],
  );

  // 6. expired mandate — minted valid, then admitted against a later clock, so
  //    this exercises the validator rather than the authoring-time expiry rule
  await mustRejectAtAdmission(
    `${tag} mandate expired against the validator clock fails closed`,
    () => profile.mint({ expiry: nowSeconds() + 3600 }),
    admit({ now: () => nowSeconds() + 7200 }),
    ["EXPIRED"],
  );

  // 7. replayed mandate hash (same credential, same validator, twice)
  await mustRejectAtAdmission(`${tag} replayed mandate hash fails closed on second admission`, () => profile.mint(), async (credential) => {
    const validator = freshValidator();
    await validator.validateAndConsume({ credential, ...args });
    await validator.validateAndConsume({ credential, ...args });
  }, ["REPLAYED"]);

  // 8. wrong expected user (session identity mismatch)
  await mustRejectAtAdmission(
    `${tag} credential signed by a different user than the session fails closed`,
    () => profile.mint(),
    admit({ args: { expectedUser: Keypair.random().publicKey() } }),
    ["SIGNER_MISMATCH"],
  );

  // 9. signer is not the mandate user (forged issuer)
  mustRefuseAtSigning(
    `${tag} package refuses to sign on behalf of another user`,
    () => profile.mint({ signer: Keypair.random() }),
    /signing key must match stellar\.user/,
  );

  // 10. replay store outage fails closed (no silent admit)
  await mustRejectAtAdmission(`${tag} replay store outage fails closed`, () => profile.mint(), async (credential) => {
    await createAp2ComplianceValidator({
      replayStore: { async consumeOnce() { throw new Error("store down"); } },
      replayNamespace: "outage-test",
    }).validateAndConsume({ credential, ...args });
  }, ["REPLAY_STORE_UNAVAILABLE"]);

  // 11. unsupported AP2 semantics are refused at signing, not quietly dropped
  for (const [what, overrides, expected] of profile.unsupportedSemantics) {
    mustRefuseAtSigning(`${tag} ${what} is refused at signing`, () => profile.mint(overrides), expected);
  }

  // 11b. CONTROL: our own re-implementation of the signing digest, used by the
  //      forgery below. If this does not admit, every forged-rejection result
  //      in this file would be meaningless — the credential would be failing on
  //      a bad signature rather than on the rule under test.
  {
    let ok = false;
    let detail = "";
    try {
      const accepted = await freshValidator().validateAndConsume({
        credential: profile.forge(() => {}),
        ...args,
      });
      ok = !!accepted?.binding?.mandate?.id;
      detail = "independently signed credential admits, so forged rejections below are meaningful";
    } catch (err) {
      detail = `re-signed credential was rejected (${err?.code ?? err?.message}); forgery checks below prove nothing`;
    }
    record(`${tag} control: independently re-signed valid credential admits`, ok, detail);
  }

  // 11c. An attacker holding the user key does not call our signer. Refusing to
  //      mint unsupported semantics is worthless if the validator would accept
  //      them when someone else signs them correctly.
  //      Pinned to the exact code: v0.1 is refused by its credential schema
  //      before rebinding, v0.2 while rebinding refuses the unsupported
  //      constraint. A regression that started returning BINDING_MISMATCH here
  //      would mean something else broke, and must not read as a pass.
  await mustRejectAtAdmission(
    `${tag} correctly signed credential carrying unsupported semantics fails closed`,
    () => profile.forge((payload) => profile.forgeUnsupported(payload)),
    admit(),
    ["INVALID_CREDENTIAL"],
  );

  // 12. payee scope widened after signing
  await mustRejectAtAdmission(`${tag} payee scope widened after signing fails closed`, () => {
    const credential = structuredClone(profile.mint());
    profile.widenPayees(credential);
    return credential;
  }, admit(), ["BINDING_MISMATCH", "INVALID_SIGNATURE", "INVALID_CREDENTIAL"]);

  // 13. a credential relabelled as the other protocol version fails closed —
  //     neither version may be parsed under the other's rules
  await mustRejectAtAdmission(`${tag} credential relabelled as the other AP2 version fails closed`, () => {
    const credential = structuredClone(profile.mint());
    credential.credentialVersion = profile.foreignCredentialVersion;
    return credential;
  }, admit(), ["INVALID_CREDENTIAL", "UNSUPPORTED_VERSION", "INVALID_SIGNATURE"]);
}

/* --------------------------------------------------------------------------
 * v0.2-only: the checkout reference that v0.1 has no concept of.
 * ------------------------------------------------------------------------ */

await mustRejectAtAdmission(
  "[v0.2] checkout reference from a different checkout fails closed",
  () => v02.mint(),
  (credential) => freshValidator().validateAndConsume({
    credential,
    ...v02.baseArgs,
    checkoutReference: "some-other-checkout",
  }),
  ["CHECKOUT_REFERENCE_MISMATCH"],
);

await mustRejectAtAdmission(
  "[v0.2] omitted checkout reference fails closed",
  () => v02.mint(),
  (credential) => freshValidator().validateAndConsume({
    credential,
    expectedUser: USER.publicKey(),
    merchant: MERCHANT,
    amount: "1.00",
  }),
  ["CHECKOUT_REFERENCE_MISMATCH"],
);

console.log(`\nA4 SUMMARY: ${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
