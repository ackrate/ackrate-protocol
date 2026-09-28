/** Canonical x402 v2 wire inspection. No signing, payment, or mandate execution. */
import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { PaymentRequiredV2Schema, type PaymentRequiredV2, type PaymentRequirementsV2 } from "@x402/core/schemas";
import type { SettleResponse } from "@x402/core/types";

export const PAYMENT_REQUIRED_HEADER = "payment-required";
export const PAYMENT_SIGNATURE_HEADER = "payment-signature";
export const PAYMENT_RESPONSE_HEADER = "payment-response";
export type StellarX402Network = "stellar:pubnet" | "stellar:testnet";
declare const atomicUnits: unique symbol;
export type AtomicAmount = string & { readonly [atomicUnits]: true };

/** Positive canonical Stellar i128 token amount; never interpret this as display units. */
export function stellarAtomicAmount(value: unknown): AtomicAmount {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 39 || BigInt(value) > (1n << 127n) - 1n) {
    throw new Error("x402: Stellar amount must be a positive atomic i128 string");
  }
  return value as AtomicAmount;
}

function decodeHeader(value: string): unknown {
  if (!value || value.length > 131072 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("x402: malformed base64 header");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("x402: noncanonical base64 header");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

/** HTTP v2 requires its header; a JSON body alone is not a canonical challenge. */
export function parseCanonical402(response: Response): PaymentRequiredV2 {
  if (response.status !== 402) throw new Error("x402: expected HTTP 402");
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header === null) throw new Error("x402: missing PAYMENT-REQUIRED header");
  return PaymentRequiredV2Schema.parse(decodeHeader(header));
}

export type StellarExactRequirement = PaymentRequirementsV2 & {
  scheme: "exact";
  network: StellarX402Network;
  amount: AtomicAmount;
};

/** Selects an explicit network/asset/payee match, skipping other schemes and chains. */
export function selectStellarExactRequirement(
  challenge: PaymentRequiredV2,
  expected: { network: StellarX402Network; asset: string; payTo: string },
): StellarExactRequirement {
  for (const offer of challenge.accepts) {
    if (offer.scheme !== "exact" || offer.network !== expected.network || offer.asset !== expected.asset || offer.payTo !== expected.payTo) continue;
    if (!StrKey.isValidContract(offer.asset) || !(StrKey.isValidEd25519PublicKey(offer.payTo) || StrKey.isValidContract(offer.payTo))) continue;
    if (!Number.isSafeInteger(offer.maxTimeoutSeconds) || offer.maxTimeoutSeconds <= 0 || offer.extra?.areFeesSponsored !== true) continue;
    try {
      return { ...offer, scheme: "exact", network: expected.network, amount: stellarAtomicAmount(offer.amount) };
    } catch { /* Another supported offer may follow. */ }
  }
  throw new Error("x402: no matching supported Stellar exact requirement");
}

/** Decode settlement metadata only. This is not independent on-chain settlement proof. */
export function parseStellarPaymentResponse(response: Response, expectedNetwork: StellarX402Network): SettleResponse {
  const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (header === null) throw new Error("x402: missing PAYMENT-RESPONSE header");
  const value = decodeHeader(header);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("x402: invalid settlement response");
  const result = value as Record<string, unknown>;
  if (typeof result.success !== "boolean" || result.network !== expectedNetwork || typeof result.transaction !== "string") throw new Error("x402: invalid settlement response");
  if (result.success && !/^[0-9a-fA-F]{64}$/.test(result.transaction)) throw new Error("x402: invalid Stellar transaction hash");
  for (const key of ["payer", "errorReason", "errorMessage"]) {
    if (result[key] !== undefined && typeof result[key] !== "string") throw new Error(`x402: invalid settlement ${key}`);
  }
  if (result.payer !== undefined && !(StrKey.isValidEd25519PublicKey(result.payer as string) || StrKey.isValidContract(result.payer as string))) throw new Error("x402: invalid settlement payer");
  if (result.amount !== undefined) stellarAtomicAmount(result.amount);
  for (const key of ["extensions", "extensionResponses", "extra"]) {
    if (result[key] !== undefined && (!result[key] || typeof result[key] !== "object" || Array.isArray(result[key]))) throw new Error(`x402: invalid settlement ${key}`);
  }
  return result as SettleResponse;
}
