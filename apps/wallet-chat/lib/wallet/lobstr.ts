"use client";

import {
  getPublicKey,
  isConnected,
  signTransaction,
} from "@lobstrco/signer-extension-api";
import { StrKey } from "@stellar/stellar-sdk";
import type { StellarSigner } from "@reapp-sdk/stellar";

export async function connectLobstr(): Promise<string> {
  const connected = await isConnected();
  const address = await getPublicKey();
  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    throw new Error(connected ? "LOBSTR did not return a valid G-address" : "Connect and unlock the LOBSTR Signer Extension first");
  }
  return address;
}

export function lobstrSigner(address: string, networkPassphrase: string): StellarSigner {
  if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("LOBSTR signer requires a valid G-address");
  return {
    publicKey: address,
    signTransaction: async (xdr, options) => {
      if (options?.address && options.address !== address) {
        return {
          signedTxXdr: "",
          signerAddress: address,
          error: { message: "LOBSTR signing address does not match the requested address", code: -1 },
        };
      }
      if (options?.networkPassphrase && options.networkPassphrase !== networkPassphrase) {
        return {
          signedTxXdr: "",
          signerAddress: address,
          error: { message: "LOBSTR signing network does not match the configured network", code: -1 },
        };
      }
      const signedTxXdr = await signTransaction(xdr);
      if (!signedTxXdr) {
        return {
          signedTxXdr: "",
          signerAddress: address,
          error: { message: "LOBSTR did not return a signed transaction", code: -1 },
        };
      }
      return { signedTxXdr, signerAddress: address };
    },
  };
}

export async function signLobstrTransaction(xdr: string): Promise<string> {
  const signed = await signTransaction(xdr);
  if (!signed) throw new Error("LOBSTR did not return a signed transaction");
  return signed;
}
