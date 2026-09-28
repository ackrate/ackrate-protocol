/** Canonical Stellar resource-server acceptance, isolated from Ackrate registry proofs. */
import { paymentMiddlewareFromConfig } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";

export { HTTPFacilitatorClient } from "@x402/core/server";
export type { FacilitatorClient, RoutesConfig } from "@x402/core/server";

/**
 * Delegate canonical verification and settlement to an explicitly configured facilitator.
 * Protected handlers must be read-only or idempotent: upstream buffers the response,
 * but invokes the handler before settlement succeeds. Never use handler execution as
 * evidence of payment. There is no Ackrate mandate registration or signing here.
 */
export function canonicalStellarPaymentMiddleware(routes: RoutesConfig, facilitator: FacilitatorClient) {
  return paymentMiddlewareFromConfig(routes, facilitator, [
    { network: "stellar:pubnet", server: new ExactStellarScheme() },
    { network: "stellar:testnet", server: new ExactStellarScheme() },
  ]);
}
