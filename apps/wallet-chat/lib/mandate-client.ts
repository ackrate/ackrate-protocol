"use client";

import { Buffer } from "buffer";
import { ackrate, type IntentMandate } from "@ackrate/core";
import type { NetworkConfig } from "@ackrate/stellar";
import type { SafeAppConfig } from "./types";
import { lobstrSigner } from "./wallet/lobstr";

if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;

export interface CreateMandateForm {
  budget: string;
  expiry: number;
}

export function publicNetwork(config: SafeAppConfig): NetworkConfig {
  return {
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    mandateRegistryId: config.mandateRegistryId,
    nativeSac: config.asset.contractId,
  };
}

export function buildMandate(config: SafeAppConfig, user: string, form: CreateMandateForm): IntentMandate {
  if (!config.agentAddress || !config.merchant.address) throw new Error("agent and merchant configuration is incomplete");
  return ackrate.createIntentMandate({
    user,
    agent: config.agentAddress,
    merchant: config.merchant.address,
    asset: config.asset.contractId,
    maxAmount: form.budget,
    expiry: form.expiry,
    decimals: config.asset.decimals,
  }, publicNetwork(config));
}

export async function registerWithLobstr(config: SafeAppConfig, mandate: IntentMandate): Promise<string> {
  return ackrate.registerMandate(
    mandate,
    { signer: lobstrSigner(mandate.user, config.networkPassphrase) },
    publicNetwork(config),
  );
}

export async function approveWithLobstr(config: SafeAppConfig, mandate: IntentMandate): Promise<string> {
  return ackrate.approveBudget(
    mandate,
    { signer: lobstrSigner(mandate.user, config.networkPassphrase) },
    publicNetwork(config),
  );
}

export async function revokeWithLobstr(config: SafeAppConfig, mandate: IntentMandate): Promise<string> {
  return ackrate.revokeMandate(
    mandate,
    { signer: lobstrSigner(mandate.user, config.networkPassphrase) },
    publicNetwork(config),
  );
}
