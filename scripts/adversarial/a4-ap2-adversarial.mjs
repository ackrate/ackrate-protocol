// Gate A4 — adversarial validation of the PUBLISHED @reapp-sdk/ap2 validator.
// Every mutation of a validly signed AP2 credential must fail closed, for BOTH
// the v0.1 IntentMandate profile and the v0.2 Open Payment Mandate profile.
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
  createAp2ComplianceValidator,
  signAp2Mandate,
  signAp2V01Mandate,
} from "@reapp-sdk/ap2";
import { reapp } from "@reapp-sdk/core";
import { Keypair } from "@stellar/stellar-sdk";

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
    ["cart-confirmation required", { intent: { user_cart_confirmation_required: true } }],
    ["refundability required", { intent: { requires_refundability: true } }],
    ["SKU-scoped intent", { intent: { skus: ["sku-1"] } }],
    ["multi-merchant intent", { merchants: [MERCHANT, OTHER_MERCHANT] }],
  ],
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
    ["bounded recurrence", { constraints: { agent_recurrence: { max_occurrences: 3 } } }],
    ["minimum payment amount", { constraints: { amount_range: { min: 1 } } }],
    ["not-before execution window", { constraints: { execution_date: { not_before: utc(nowSeconds() + 60) } } }],
    ["multi-payee scope", { payees: [{ id: MERCHANT, name: "A" }, { id: OTHER_MERCHANT, name: "B" }] }],
    ["confirmation key that is not the agent", {
      cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: Buffer.from(Keypair.random().rawPublicKey()).toString("base64url") } },
    }],
  ],
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

function mustRefuseAtSigning(name, mint) {
  try {
    mint();
    record(name, false, "package minted a credential it cannot enforce");
  } catch (err) {
    record(name, true, String(err?.message ?? err).slice(0, 100));
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
  );

  // 10. replay store outage fails closed (no silent admit)
  await mustRejectAtAdmission(`${tag} replay store outage fails closed`, () => profile.mint(), async (credential) => {
    await createAp2ComplianceValidator({
      replayStore: { async consumeOnce() { throw new Error("store down"); } },
      replayNamespace: "outage-test",
    }).validateAndConsume({ credential, ...args });
  }, ["REPLAY_STORE_UNAVAILABLE"]);

  // 11. unsupported AP2 semantics are refused at signing, not quietly dropped
  for (const [what, overrides] of profile.unsupportedSemantics) {
    mustRefuseAtSigning(`${tag} ${what} is refused at signing`, () => profile.mint(overrides));
  }

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
