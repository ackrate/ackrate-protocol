import { Buffer } from "node:buffer";
import { ackrate, type IntentMandate } from "@ackrate/core";
import { registryClient, stellarSigner, type Mandate, type NetworkConfig, type StellarSignerInput } from "@ackrate/stellar";
import type { StoredMandate } from "./mandate-store.js";

/** Restore a saved registry id only after the chain matches its original signed
 * credential and full policy. This read cannot authorize or submit a payment. */
export async function restoreRegisteredMandate(
  stored: StoredMandate,
  net: NetworkConfig,
  signer: StellarSignerInput,
  readMandate: (id: Buffer) => Promise<Mandate> = async (id) =>
    (await registryClient(net, stellarSigner(signer, net.networkPassphrase))
      .get_mandate({ mandate_id: id })).result.unwrap(),
): Promise<IntentMandate> {
  if (!/^[0-9a-f]{64}$/.test(stored.id)) throw new Error("stored mandate registry identifier is invalid");
  const mandate = ackrate.createIntentMandate(stored.inputs, net);
  const registeredId = Buffer.from(stored.id, "hex");
  const chain = await readMandate(registeredId);
  if (chain.user !== mandate.user || chain.agent !== mandate.agent
    || chain.merchant !== mandate.merchant || chain.asset !== mandate.asset
    || chain.max_amount !== mandate.maxAmount || chain.expiry !== BigInt(mandate.expiry)
    || !(chain.vc_hash instanceof Uint8Array) || !Buffer.from(chain.vc_hash).equals(mandate.idBuffer)) {
    throw new Error("saved registry mandate does not match the stored credential and payment policy");
  }
  mandate.credentialHash = mandate.id;
  mandate.id = stored.id;
  mandate.idBuffer = registeredId;
  return mandate;
}
