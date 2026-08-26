import { Buffer } from "buffer";
import { Client, type Mandate } from "@ackrate/stellar";
import type { NetworkConfig } from "@ackrate/stellar";
import type { MandateView } from "./types";

export function assertMandateId(id: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("mandate id must be 64 lowercase hexadecimal characters");
  return Buffer.from(id, "hex");
}

function statusTag(status: Mandate["status"]): MandateView["status"] {
  if (status.tag === "Active" || status.tag === "Revoked" || status.tag === "Exhausted") return status.tag;
  throw new Error("contract returned an unknown mandate status");
}

export function mandateView(id: string, mandate: Mandate): MandateView {
  const maxAmount = BigInt(mandate.max_amount);
  const spent = BigInt(mandate.spent);
  if (spent < 0n || maxAmount < spent) throw new Error("contract returned an invalid mandate accounting invariant");
  return {
    id,
    user: mandate.user,
    agent: mandate.agent,
    merchant: mandate.merchant,
    asset: mandate.asset,
    maxAmount: maxAmount.toString(),
    spent: spent.toString(),
    remaining: (maxAmount - spent).toString(),
    expiry: Number(mandate.expiry),
    seq: Number(mandate.seq),
    status: statusTag(mandate.status),
  };
}

export async function readMandate(network: NetworkConfig, source: string, id: string): Promise<MandateView> {
  const client = new Client({
    contractId: network.mandateRegistryId,
    rpcUrl: network.rpcUrl,
    networkPassphrase: network.networkPassphrase,
    publicKey: source,
    allowHttp: network.rpcUrl.startsWith("http://"),
  });
  const read = await client.get_mandate({ mandate_id: assertMandateId(id) });
  return mandateView(id, read.result.unwrap());
}

export function assertMandateBindings(
  mandate: MandateView,
  expected: { user: string; agent: string; merchant: string; asset: string },
  now = Math.floor(Date.now() / 1_000),
): void {
  if (mandate.user !== expected.user) throw new Error("mandate user does not match the authenticated wallet");
  if (mandate.agent !== expected.agent) throw new Error("mandate agent does not match this application");
  if (mandate.merchant !== expected.merchant) throw new Error("mandate merchant does not match the configured fulfillment agent");
  if (mandate.asset !== expected.asset) throw new Error("mandate asset does not match the configured settlement asset");
  if (mandate.status !== "Active") throw new Error(`mandate is ${mandate.status.toLowerCase()}`);
  if (mandate.expiry <= now) throw new Error("mandate has expired");
}
