/**
 * AP2 v0.1 credential compatibility.
 *
 * This preserves the exact fail-closed IntentMandate envelope minted and
 * admitted by the 0.3.x package, so a v0.1 credential signed by 0.3.0 and one
 * signed by this package are byte-identical. It is intentionally isolated from
 * the v0.2 Payment Mandate schema so neither version can be interpreted as the
 * other, and the version is always chosen explicitly at the call site:
 * `signAp2V01Mandate` for v0.1, `signAp2Mandate` for v0.2.
 */
import { Buffer } from "buffer";
import { Address, Keypair, StrKey, hash } from "@stellar/stellar-sdk";
import { reapp, type IntentMandate } from "@reapp-sdk/core";

export const REAPP_AP2_V01_CREDENTIAL_VERSION = "reapp-ap2-credential/1" as const;
export const REAPP_AP2_V01_SIGNATURE_ALGORITHM = "stellar-ed25519-sha256" as const;
export const AP2_V01_SPEC_VERSION = "0.1.0" as const;
export const AP2_V01_INTENT_DATA_KEY = "ap2.mandates.IntentMandate" as const;
export const REAPP_AP2_V01_BINDING_VERSION = "reapp-ap2/1" as const;

const SIGNATURE_DOMAIN = "REAPP\0AP2\0SIGNED-MANDATE\0V1\0";
const LOWER_HEX_32 = /^[0-9a-f]{64}$/;
const CANONICAL_BASE64_64 = /^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/;

export interface NormalizedAp2V01IntentMandate {
  user_cart_confirmation_required: false;
  natural_language_description: string;
  merchants: [string];
  skus: [];
  requires_refundability: false;
  intent_expiry: string;
}

/** AP2 v0.1.0 IntentMandate data shape (wire names preserved) accepted as input. */
export interface Ap2V01IntentMandate {
  user_cart_confirmation_required: boolean;
  natural_language_description: string;
  merchants?: readonly string[];
  skus?: readonly string[];
  requires_refundability?: boolean;
  intent_expiry: string;
}

/** Stellar-specific authorization that AP2 v0.1's commerce intent does not carry. */
export interface StellarV01MandateAuthorization {
  user: string;
  agent: string;
  asset: string;
  /** Human amount, such as "5.00". */
  maxAmount: string;
  /** Token decimals; defaults to Stellar's 7. */
  decimals?: number;
  /** Optional reproducibility nonce; secure random bytes are used by default. */
  nonce?: string;
}

export interface BindIntentMandateInput {
  intent: Ap2V01IntentMandate;
  stellar: StellarV01MandateAuthorization;
}

export interface ReappAp2V01CredentialPayload {
  ap2SpecVersion: typeof AP2_V01_SPEC_VERSION;
  ap2DataKey: typeof AP2_V01_INTENT_DATA_KEY;
  bindingVersion: typeof REAPP_AP2_V01_BINDING_VERSION;
  intent: NormalizedAp2V01IntentMandate;
  stellar: {
    user: string;
    agent: string;
    asset: string;
    maxAmount: string;
    decimals: number;
    nonce: string;
  };
}

export interface SignedAp2V01Mandate {
  credentialVersion: typeof REAPP_AP2_V01_CREDENTIAL_VERSION;
  payload: ReappAp2V01CredentialPayload;
  mandateHash: string;
  signature: {
    algorithm: typeof REAPP_AP2_V01_SIGNATURE_ALGORITHM;
    value: string;
  };
}

export interface Ap2V01MandateBinding {
  ap2SpecVersion: typeof AP2_V01_SPEC_VERSION;
  ap2DataKey: typeof AP2_V01_INTENT_DATA_KEY;
  bindingVersion: typeof REAPP_AP2_V01_BINDING_VERSION;
  normalizedIntent: NormalizedAp2V01IntentMandate;
  canonicalIntent: string;
  intentHash: string;
  bindingNonce: string;
  mandate: IntentMandate;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(label: string, value: unknown): UnknownRecord {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value;
}

function requireExactKeys(label: string, value: UnknownRecord, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function requireText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty string without surrounding whitespace.`);
  }
  return value;
}

function requireStringArray(label: string, value: unknown, length: number): string[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} item${length === 1 ? "" : "s"}.`);
  }
  return value.map((item, index) => requireText(`${label}[${index}]`, item));
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  if (!isRecord(value)) throw new Error("canonical JSON values must be plain data");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

/**
 * As with v0.2, the digest covers the whole payload through `canonicalize`, so
 * the parameter is the full payload type rather than the three fields spliced
 * into the domain prefix below.
 */
export function ap2V01CredentialSigningDigest(
  credentialVersion: string,
  payload: ReappAp2V01CredentialPayload,
  mandateHash: string,
): Buffer {
  if (!LOWER_HEX_32.test(mandateHash)) {
    throw new Error("mandateHash must be lowercase 32-byte hex.");
  }
  const payloadHash = hash(Buffer.from(canonicalize(payload), "utf8"));
  return hash(Buffer.concat([
    Buffer.from(SIGNATURE_DOMAIN, "utf8"),
    Buffer.from(credentialVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(payload.ap2SpecVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(payload.ap2DataKey, "utf8"),
    Buffer.from([0]),
    Buffer.from(payload.bindingVersion, "utf8"),
    Buffer.from([0]),
    payloadHash,
    Buffer.from([0]),
    Buffer.from(mandateHash, "hex"),
  ]));
}

export function parseSignedAp2V01Mandate(value: unknown): SignedAp2V01Mandate {
  const envelope = requireRecord("credential", value);
  requireExactKeys("credential", envelope, [
    "credentialVersion",
    "payload",
    "mandateHash",
    "signature",
  ]);
  const payloadValue = requireRecord("credential.payload", envelope.payload);
  requireExactKeys("credential.payload", payloadValue, [
    "ap2SpecVersion",
    "ap2DataKey",
    "bindingVersion",
    "intent",
    "stellar",
  ]);
  const intentValue = requireRecord("credential.payload.intent", payloadValue.intent);
  requireExactKeys("credential.payload.intent", intentValue, [
    "user_cart_confirmation_required",
    "natural_language_description",
    "merchants",
    "skus",
    "requires_refundability",
    "intent_expiry",
  ]);
  if (intentValue.user_cart_confirmation_required !== false) {
    throw new Error("credential intent must be human-not-present.");
  }
  if (intentValue.requires_refundability !== false) {
    throw new Error("credential intent cannot require unenforced refundability.");
  }
  const merchants = requireStringArray(
    "credential.payload.intent.merchants",
    intentValue.merchants,
    1,
  );
  const skus = requireStringArray("credential.payload.intent.skus", intentValue.skus, 0);

  const stellarValue = requireRecord("credential.payload.stellar", payloadValue.stellar);
  requireExactKeys("credential.payload.stellar", stellarValue, [
    "user",
    "agent",
    "asset",
    "maxAmount",
    "decimals",
    "nonce",
  ]);
  if (
    !Number.isInteger(stellarValue.decimals) ||
    (stellarValue.decimals as number) < 0 ||
    (stellarValue.decimals as number) > 38
  ) {
    throw new Error("credential.payload.stellar.decimals must be an integer from 0 through 38.");
  }
  const signatureValue = requireRecord("credential.signature", envelope.signature);
  requireExactKeys("credential.signature", signatureValue, ["algorithm", "value"]);
  const mandateHash = requireText("credential.mandateHash", envelope.mandateHash);
  if (!LOWER_HEX_32.test(mandateHash)) {
    throw new Error("credential.mandateHash must be lowercase 32-byte hex.");
  }

  return {
    credentialVersion: requireText(
      "credential.credentialVersion",
      envelope.credentialVersion,
    ) as typeof REAPP_AP2_V01_CREDENTIAL_VERSION,
    payload: {
      ap2SpecVersion: requireText(
        "credential.payload.ap2SpecVersion",
        payloadValue.ap2SpecVersion,
      ) as typeof AP2_V01_SPEC_VERSION,
      ap2DataKey: requireText(
        "credential.payload.ap2DataKey",
        payloadValue.ap2DataKey,
      ) as typeof AP2_V01_INTENT_DATA_KEY,
      bindingVersion: requireText(
        "credential.payload.bindingVersion",
        payloadValue.bindingVersion,
      ) as typeof REAPP_AP2_V01_BINDING_VERSION,
      intent: {
        user_cart_confirmation_required: false,
        natural_language_description: requireText(
          "credential.payload.intent.natural_language_description",
          intentValue.natural_language_description,
        ),
        merchants: [merchants[0]!],
        skus: skus as [],
        requires_refundability: false,
        intent_expiry: requireText(
          "credential.payload.intent.intent_expiry",
          intentValue.intent_expiry,
        ),
      },
      stellar: {
        user: requireText("credential.payload.stellar.user", stellarValue.user),
        agent: requireText("credential.payload.stellar.agent", stellarValue.agent),
        asset: requireText("credential.payload.stellar.asset", stellarValue.asset),
        maxAmount: requireText("credential.payload.stellar.maxAmount", stellarValue.maxAmount),
        decimals: stellarValue.decimals as number,
        nonce: requireText("credential.payload.stellar.nonce", stellarValue.nonce),
      },
    },
    mandateHash,
    signature: {
      algorithm: requireText(
        "credential.signature.algorithm",
        signatureValue.algorithm,
      ) as typeof REAPP_AP2_V01_SIGNATURE_ALGORITHM,
      value: requireText("credential.signature.value", signatureValue.value),
    },
  };
}

export function decodeCanonicalV01Signature(value: string): Buffer {
  if (!CANONICAL_BASE64_64.test(value)) {
    throw new Error("credential.signature.value must be canonical base64 for 64 bytes.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) {
    throw new Error("credential.signature.value must decode to exactly 64 bytes.");
  }
  return bytes;
}

export function rebuildV01CredentialBinding(
  payload: ReappAp2V01CredentialPayload,
): Ap2V01MandateBinding {
  const canonicalIntent = canonicalize(payload.intent);
  const intentHash = hash(Buffer.from(canonicalIntent, "utf8")).toString("hex");
  const expiryMs = Date.parse(payload.intent.intent_expiry);
  const canonicalExpiry = Number.isFinite(expiryMs)
    ? new Date(expiryMs).toISOString().replace(".000Z", "Z")
    : "";
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(payload.intent.intent_expiry) ||
    canonicalExpiry !== payload.intent.intent_expiry
  ) {
    throw new Error("credential expiry must be a real canonical UTC whole-second timestamp.");
  }
  const coreNonce = `${payload.bindingVersion}:${intentHash}:${payload.stellar.nonce}`;
  const mandate = reapp.createIntentMandate({
    user: payload.stellar.user,
    agent: payload.stellar.agent,
    merchant: payload.intent.merchants[0],
    asset: payload.stellar.asset,
    maxAmount: payload.stellar.maxAmount,
    expiry: expiryMs / 1_000,
    decimals: payload.stellar.decimals,
    nonce: coreNonce,
  });
  return {
    ap2SpecVersion: payload.ap2SpecVersion,
    ap2DataKey: payload.ap2DataKey,
    bindingVersion: payload.bindingVersion,
    normalizedIntent: payload.intent,
    canonicalIntent,
    intentHash,
    bindingNonce: payload.stellar.nonce,
    mandate,
  };
}

/* ------------------------------------------------------------------------- *
 * Minting. Everything below reproduces the 0.3.0 authoring path exactly, so a
 * v0.1 credential minted here verifies against a 0.3.x validator and vice
 * versa. `v01_matches_the_published_0_3_0_vector` in legacy-v01.test.ts pins
 * that against real 0.3.0 output; treat any change here as a wire break.
 * ------------------------------------------------------------------------- */

function requirePlainObject(label: string, value: unknown): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as UnknownRecord;
}

function rejectUnknownKeys(label: string, value: unknown, allowed: readonly string[]): UnknownRecord {
  const object = requirePlainObject(label, value);
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported field ${JSON.stringify(unknown[0])}.`);
  }
  return object;
}

function requireStellarAddress(label: string, value: unknown): string {
  const address = requireText(label, value);
  try {
    Address.fromString(address);
  } catch {
    throw new Error(`${label} must be a valid Stellar address.`);
  }
  return address;
}

function requireEd25519Address(label: string, value: unknown): string {
  const address = requireText(label, value);
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error(`${label} must be a Stellar G-address.`);
  }
  return address;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * v0.1 accepted a UTC offset on input and normalized it to `Z`; v0.2 requires
 * `Z` up front. Keeping the looser input rule here is what makes an existing
 * 0.3.x caller's mandate hash come out unchanged.
 */
function normalizeExpiry(value: unknown): { iso: string; unixSeconds: number } {
  const expiry = requireText("intent.intent_expiry", value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.000)?(Z|[+-](\d{2}):(\d{2}))$/.exec(expiry);
  if (!match) {
    throw new Error(
      "intent.intent_expiry must be an ISO 8601 timestamp with a timezone and whole-second precision.",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new Error("intent.intent_expiry must be a real calendar timestamp.");
  }
  const milliseconds = Date.parse(expiry);
  if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
    throw new Error("intent.intent_expiry must be a valid whole-second ISO 8601 timestamp.");
  }
  const iso = new Date(milliseconds).toISOString().replace(".000Z", "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) {
    throw new Error(
      "intent.intent_expiry must normalize within the supported four-digit UTC year range.",
    );
  }
  const unixSeconds = milliseconds / 1000;
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= Math.floor(Date.now() / 1000)) {
    throw new Error("intent.intent_expiry must resolve to a future Unix timestamp.");
  }
  return { iso, unixSeconds };
}

/**
 * Normalize and validate the AP2 v0.1 subset REAPP can enforce without
 * inventing application-only policy. Unsupported constraints fail closed.
 */
export function normalizeAp2V01Intent(intent: Ap2V01IntentMandate): {
  intent: NormalizedAp2V01IntentMandate;
  unixExpiry: number;
} {
  rejectUnknownKeys("intent", intent, [
    "user_cart_confirmation_required",
    "natural_language_description",
    "merchants",
    "skus",
    "requires_refundability",
    "intent_expiry",
  ]);
  if (intent.user_cart_confirmation_required !== false) {
    throw new Error(
      "REAPP's AP2 bridge requires user_cart_confirmation_required=false; cart-confirmation state is not enforced by MandateRegistry.",
    );
  }
  const description = requireText(
    "intent.natural_language_description",
    intent.natural_language_description,
  );
  if (!Array.isArray(intent.merchants) || intent.merchants.length !== 1) {
    throw new Error("intent.merchants must contain exactly one Stellar merchant address.");
  }
  const merchant = requireStellarAddress("intent.merchants[0]", intent.merchants[0]);
  if (intent.skus !== undefined && (!Array.isArray(intent.skus) || intent.skus.length > 0)) {
    throw new Error(
      "intent.skus is not supported because MandateRegistry does not enforce SKU constraints.",
    );
  }
  if (intent.requires_refundability === true) {
    throw new Error(
      "intent.requires_refundability=true is not supported because MandateRegistry does not enforce refundability.",
    );
  }
  if (
    intent.requires_refundability !== undefined &&
    typeof intent.requires_refundability !== "boolean"
  ) {
    throw new Error("intent.requires_refundability must be a boolean when present.");
  }
  const expiry = normalizeExpiry(intent.intent_expiry);
  return {
    intent: {
      user_cart_confirmation_required: false,
      natural_language_description: description,
      merchants: [merchant],
      skus: [],
      requires_refundability: false,
      intent_expiry: expiry.iso,
    },
    unixExpiry: expiry.unixSeconds,
  };
}

function secureNonce(): string {
  type CryptoSource = { getRandomValues(bytes: Uint8Array): Uint8Array };
  const source = (globalThis as typeof globalThis & { crypto?: CryptoSource }).crypto;
  if (!source) {
    throw new Error("Web Crypto is required to create a secure AP2 binding nonce.");
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    return Object.freeze(value) as Readonly<T>;
  }
  return value;
}

/**
 * Bind a supported AP2 v0.1 IntentMandate to REAPP's existing core mandate.
 *
 * The AP2 hash is embedded in core's existing nonce field under the
 * `reapp-ap2/1` binding version, so an id minted here is the same id 0.3.0
 * minted for the same inputs.
 */
export function bindIntentMandate(input: BindIntentMandateInput): Ap2V01MandateBinding {
  rejectUnknownKeys("input", input, ["intent", "stellar"]);
  rejectUnknownKeys("stellar", input.stellar, [
    "user",
    "agent",
    "asset",
    "maxAmount",
    "decimals",
    "nonce",
  ]);
  const normalized = normalizeAp2V01Intent(input.intent);
  const canonicalIntent = canonicalize(normalized.intent);
  const intentHash = hash(Buffer.from(canonicalIntent, "utf8")).toString("hex");

  const user = requireEd25519Address("stellar.user", input.stellar.user);
  const agent = requireEd25519Address("stellar.agent", input.stellar.agent);
  const asset = requireText("stellar.asset", input.stellar.asset);
  if (!StrKey.isValidContract(asset)) {
    throw new Error("stellar.asset must be a valid Stellar contract address.");
  }

  const bindingNonce = input.stellar.nonce === undefined
    ? secureNonce()
    : requireText("stellar.nonce", input.stellar.nonce);
  const decimals = input.stellar.decimals ?? 7;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new Error("stellar.decimals must be an integer from 0 through 38.");
  }
  const maxAmount = requireText("stellar.maxAmount", input.stellar.maxAmount);
  const coreNonce = `${REAPP_AP2_V01_BINDING_VERSION}:${intentHash}:${bindingNonce}`;
  const mandate = reapp.createIntentMandate({
    user,
    agent,
    merchant: normalized.intent.merchants[0],
    asset,
    maxAmount,
    expiry: normalized.unixExpiry,
    decimals,
    nonce: coreNonce,
  });

  return {
    ap2SpecVersion: AP2_V01_SPEC_VERSION,
    ap2DataKey: AP2_V01_INTENT_DATA_KEY,
    bindingVersion: REAPP_AP2_V01_BINDING_VERSION,
    normalizedIntent: normalized.intent,
    canonicalIntent,
    intentHash,
    bindingNonce,
    mandate,
  };
}

/**
 * Sign a supported AP2 v0.1 IntentMandate with its Stellar user key.
 *
 * Deliberately not named `signAp2Mandate`: that name now means v0.2, and a
 * caller must never get a different protocol version than the one it asked for.
 * A 0.3.x call site that upgrades without changing the name fails closed on the
 * unknown `intent` key rather than silently switching versions.
 */
export function signAp2V01Mandate(
  input: BindIntentMandateInput,
  signer: Keypair,
): Readonly<SignedAp2V01Mandate> {
  const binding = bindIntentMandate(input);
  if (signer.publicKey() !== binding.mandate.user) {
    throw new Error("the signing key must match stellar.user.");
  }
  const payload: ReappAp2V01CredentialPayload = {
    ap2SpecVersion: binding.ap2SpecVersion,
    ap2DataKey: binding.ap2DataKey,
    bindingVersion: binding.bindingVersion,
    intent: binding.normalizedIntent,
    stellar: {
      user: binding.mandate.user,
      agent: binding.mandate.agent,
      asset: binding.mandate.asset,
      maxAmount: String(input.stellar.maxAmount).trim(),
      decimals: binding.mandate.decimals,
      nonce: binding.bindingNonce,
    },
  };
  const digest = ap2V01CredentialSigningDigest(
    REAPP_AP2_V01_CREDENTIAL_VERSION,
    payload,
    binding.mandate.id,
  );
  return deepFreeze({
    credentialVersion: REAPP_AP2_V01_CREDENTIAL_VERSION,
    payload,
    mandateHash: binding.mandate.id,
    signature: {
      algorithm: REAPP_AP2_V01_SIGNATURE_ALGORITHM,
      value: signer.sign(digest).toString("base64"),
    },
  });
}
