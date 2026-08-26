import {
  DeliveryPendingError,
  getSettlementReceipt,
  ackrate,
  toStroops,
  type IntentMandate,
} from "@ackrate/core";
import type { AppConfig } from "./app-config";
import { boundedResponseJson } from "./http";
import { completeToolCall, DurableReceiptStore, reserveToolCall } from "./journal";
import { assertMandateBindings, readMandate } from "./mandate-state";

export interface PurchaseInput {
  config: AppConfig;
  sessionAddress: string;
  sessionId: string;
  toolCallId: string;
  mandateId: string;
  sourceId: string;
}

export async function purchaseCatalogItem(input: PurchaseInput): Promise<unknown> {
  const { config } = input;
  if (!config.agentSecret || !config.merchantUrl || !config.public.agentAddress || !config.public.merchant.address) {
    throw new Error("payment execution is not configured");
  }
  const item = config.public.catalog.find((candidate) => candidate.id === input.sourceId);
  if (!item) throw new Error("the requested source is not in the server allowlist");
  const reservation = await reserveToolCall({
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    mandateId: input.mandateId,
    sourceId: input.sourceId,
  });
  if (!reservation.created) {
    if (reservation.record.mandateId !== input.mandateId || reservation.record.sourceId !== input.sourceId) {
      throw new Error("tool call id was already bound to different payment inputs");
    }
    if (reservation.record.status === "succeeded") return reservation.record.result;
    if (reservation.record.status === "running") throw new Error("this purchase is already in progress");
    if (reservation.record.status === "failed") throw new Error("this exact purchase attempt previously failed; start a new chat request");
  }

  const onChain = await readMandate(config.network, input.sessionAddress, input.mandateId);
  assertMandateBindings(onChain, {
    user: input.sessionAddress,
    agent: config.public.agentAddress,
    merchant: config.public.merchant.address,
    asset: config.public.asset.contractId,
  });
  const amount = toStroops(item.price, config.public.asset.decimals);
  if (BigInt(onChain.remaining) < amount) throw new Error("the contract mandate does not have enough remaining budget");

  const mandate: IntentMandate = {
    id: onChain.id,
    idBuffer: Buffer.from(onChain.id, "hex"),
    user: onChain.user,
    agent: onChain.agent,
    merchant: onChain.merchant,
    asset: onChain.asset,
    maxAmount: BigInt(onChain.maxAmount),
    expiry: onChain.expiry,
    decimals: config.public.asset.decimals,
  };
  const receiptStore = new DurableReceiptStore(input.sessionId, input.mandateId);
  const consumer = ackrate.agent({
    mandate,
    signer: config.agentSecret,
    proofPolicy: "bound-v2-only",
    receiptStore,
  }, config.network);
  const url = new URL(item.path, config.merchantUrl).toString();
  let deliveredReceipt: ReturnType<typeof getSettlementReceipt>;

  try {
    const response = await consumer.fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`merchant delivery failed with HTTP ${response.status}`);
    const receipt = getSettlementReceipt(response);
    if (!receipt) throw new Error("paid response did not carry a settlement receipt");
    deliveredReceipt = receipt;
    const delivered = await boundedResponseJson(response);
    const result = {
      source: { id: item.id, title: item.title },
      payment: {
        status: "settled",
        amount: item.price,
        asset: config.public.asset.code,
        txHash: receipt.txHash,
        mandateId: receipt.mandateId,
      },
      delivered,
    };
    await completeToolCall({
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      status: "succeeded",
      result,
    });
    await consumer.acknowledgeDelivery(receipt).catch(() => undefined);
    return result;
  } catch (error) {
    const pendingReceipt = error instanceof DeliveryPendingError ? error.receipt : deliveredReceipt;
    if (pendingReceipt) {
      const pending = {
        status: "delivery_pending",
        txHash: pendingReceipt.txHash,
        mandateId: pendingReceipt.mandateId,
        message: "Settlement may have occurred, but delivery is pending. The exact receipt is retained for recovery; do not issue a second payment.",
      };
      await completeToolCall({
        sessionId: input.sessionId,
        toolCallId: input.toolCallId,
        status: "delivery_pending",
        result: pending,
      });
      throw new Error(pending.message, { cause: error });
    }
    await completeToolCall({
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      status: "failed",
      result: { message: error instanceof Error ? error.message : "purchase failed" },
    });
    throw error;
  }
}
