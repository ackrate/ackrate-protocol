/** Signer shapes shared by Node keypairs and user-controlled wallets. */
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  basicNodeSigner,
  type SignAuthEntry,
  type SignTransaction,
} from "@stellar/stellar-sdk/contract";

/**
 * Minimum signer boundary accepted by REAPP's transaction builders. Wallets
 * implement this shape without exposing secret material to the SDK or app.
 */
export interface StellarSigner {
  publicKey: string;
  signTransaction: SignTransaction;
  signAuthEntry?: SignAuthEntry;
}

export interface KeypairSigner extends StellarSigner {
  keypair: Keypair;
  signAuthEntry: SignAuthEntry;
}

export type StellarSignerInput = string | Keypair | StellarSigner;

export function isStellarSigner(value: unknown): value is StellarSigner {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StellarSigner>;
  return (
    typeof candidate.publicKey === "string"
    && StrKey.isValidEd25519PublicKey(candidate.publicKey)
    && typeof candidate.signTransaction === "function"
    && (candidate.signAuthEntry === undefined || typeof candidate.signAuthEntry === "function")
  );
}

export function keypairSigner(
  secretOrKeypair: string | Keypair,
  networkPassphrase: string,
): KeypairSigner {
  const keypair =
    typeof secretOrKeypair === "string" ? Keypair.fromSecret(secretOrKeypair) : secretOrKeypair;
  const node = basicNodeSigner(keypair, networkPassphrase);
  return {
    publicKey: keypair.publicKey(),
    keypair,
    signTransaction: node.signTransaction,
    signAuthEntry: node.signAuthEntry,
  };
}

/** Normalize a local key or external wallet into the same secret-free shape. */
export function stellarSigner(
  input: StellarSignerInput,
  networkPassphrase: string,
): StellarSigner {
  if (isStellarSigner(input)) return input;
  return keypairSigner(input, networkPassphrase);
}
