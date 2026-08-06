/** Factory for a MandateRegistry contract client wired to a network + signer. */
import { Client } from "./client.js";
import type { NetworkConfig } from "./config.js";
import type { StellarSigner } from "./signer.js";

export function registryClient(net: NetworkConfig, signer: StellarSigner): Client {
  return new Client({
    contractId: net.mandateRegistryId,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.networkPassphrase,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
    allowHttp: net.rpcUrl.startsWith("http://"),
  });
}
