import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StrKey } from "@stellar/stellar-sdk";
import type { SignTransaction } from "@stellar/stellar-sdk/contract";
import type { NetworkConfig, StellarSigner } from "@ackrate/stellar";

const execute = promisify(execFile);

function identityName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || /[\r\n\0]/.test(normalized)) {
    throw new Error("Stellar signer identity must be a non-empty local identity name");
  }
  return normalized;
}

async function stellar(args: string[]): Promise<string> {
  try {
    const { stdout } = await execute("stellar", args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 180_000,
    });
    return stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Stellar CLI signer failed: ${detail}`);
  }
}

/**
 * Keep transaction custody in a Stellar CLI identity or connected Ledger.
 * No secret is accepted on the command line, stored by Ackrate, or printed.
 */
export async function stellarCliSigner(
  identityInput: string,
  net: NetworkConfig,
): Promise<StellarSigner> {
  const identity = identityName(identityInput);
  const publicKey = await stellar(["keys", "public-key", identity, "--quiet"]);
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error(`Stellar identity ${JSON.stringify(identity)} did not resolve to a G-account`);
  }
  const signTransaction: SignTransaction = async (xdr, options) => {
    if (options?.networkPassphrase && options.networkPassphrase !== net.networkPassphrase) {
      throw new Error("external signer refused a conflicting network passphrase");
    }
    if (options?.address && options.address !== publicKey) {
      throw new Error("external signer refused a transaction for another account");
    }
    const signedTxXdr = await stellar([
      "tx", "sign", xdr,
      "--sign-with-key", identity,
      "--network-passphrase", net.networkPassphrase,
      "--rpc-url", net.rpcUrl,
      "--quiet",
    ]);
    if (!signedTxXdr) throw new Error("Stellar CLI signer returned an empty transaction envelope");
    return { signedTxXdr, signerAddress: publicKey };
  };
  return Object.freeze({
    publicKey,
    signTransaction,
  });
}
