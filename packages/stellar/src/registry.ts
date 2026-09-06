/** Factory for a MandateRegistry contract client wired to a network + signer. */
import { Client } from "./client.js";
import { Client as LegacyClient } from "./legacy-client.js";
import { TESTNET, type NetworkConfig } from "./config.js";
import type { ReleaseNetworkConfig } from "./release-manifest.js";
import type { StellarSigner } from "./signer.js";

/** The official Mainnet configuration exposes the full V2 ABI. */
export function registryClient(net: ReleaseNetworkConfig, signer: StellarSigner): Client;
/** The explicitly selected older deployment retains its compatible ABI. */
export function registryClient(net: NetworkConfig, signer: StellarSigner): Client | LegacyClient;
export function registryClient(net: NetworkConfig, signer: StellarSigner): Client | LegacyClient {
  const Binding = net.networkPassphrase === TESTNET.networkPassphrase
    && net.mandateRegistryId === TESTNET.mandateRegistryId ? LegacyClient : Client;
  return new Binding({
    contractId: net.mandateRegistryId,
    rpcUrl: net.rpcUrl,
    networkPassphrase: net.networkPassphrase,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
    allowHttp: net.rpcUrl.startsWith("http://"),
  });
}
