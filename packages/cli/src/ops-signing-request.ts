/**
 * Secret-free coordination for the native Stellar 2-of-3 authority.
 *
 * This module never accepts a secret key. It binds an exact transaction
 * envelope to a human-readable effect summary derived from that envelope,
 * verifies independently signed copies, rejects mixed requests and duplicate
 * signers, and emits an envelope containing exactly two valid signatures.
 */
import { createHash } from "node:crypto";
import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";

export type AuthorityNetwork = "testnet" | "mainnet";

export interface AuthoritySigner {
  label: "A" | "B" | "C";
  publicKey: string;
}

export interface AuthorityManifest {
  version: 1;
  network: AuthorityNetwork;
  authorityAccount: string;
  requiredSignatures: 2;
  signers: [AuthoritySigner, AuthoritySigner, AuthoritySigner];
}

interface TransactionEffect {
  target: string;
  function: string;
  argsXdr: string[];
  argsSha256: string;
}

interface BoundTransaction {
  unsignedEnvelopeXdr: string;
  hash: string;
  source: string;
  sequence: string;
  fee: string;
  timeBounds: { minTime: string; maxTime: string } | null;
  ledgerBounds: { minLedger: number; maxLedger: number } | null;
  effect: TransactionEffect;
}

export interface SigningRequest {
  version: 1;
  requestId: string;
  network: AuthorityNetwork;
  networkPassphrase: string;
  authorityAccount: string;
  requiredSignatures: 2;
  signers: [AuthoritySigner, AuthoritySigner, AuthoritySigner];
  transaction: BoundTransaction;
}

export interface CombinedEnvelope {
  requestId: string;
  transactionHash: string;
  signerPublicKeys: [string, string];
  signedEnvelopeXdr: string;
}

const REQUEST_KEYS = [
  "version",
  "requestId",
  "network",
  "networkPassphrase",
  "authorityAccount",
  "requiredSignatures",
  "signers",
  "transaction",
] as const;

const TRANSACTION_KEYS = [
  "unsignedEnvelopeXdr",
  "hash",
  "source",
  "sequence",
  "fee",
  "timeBounds",
  "ledgerBounds",
  "effect",
] as const;

const EFFECT_KEYS = ["target", "function", "argsXdr", "argsSha256"] as const;
const SIGNER_KEYS = ["label", "publicKey"] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(",")}}`;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
  );
}

function passphraseFor(network: AuthorityNetwork): string {
  return network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

function parseTransaction(
  envelopeXdr: string,
  networkPassphrase: string,
): Transaction {
  const parsed = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  if (parsed instanceof FeeBumpTransaction || !(parsed instanceof Transaction)) {
    throw new Error("fee-bump envelopes are not accepted for authority requests");
  }
  if (parsed.operations.length !== 1) {
    throw new Error("authority request must contain exactly one operation");
  }
  return parsed;
}

function extractEffect(transaction: Transaction): TransactionEffect {
  const operation = transaction.operations[0]!;
  if (operation.type !== "invokeHostFunction") {
    throw new Error("authority request must be one invokeHostFunction operation");
  }
  if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new Error("authority request must invoke an existing contract");
  }

  const invocation = operation.func.invokeContract();
  const argsXdr = invocation.args().map((arg) => arg.toXDR("base64"));
  return {
    target: Address.fromScAddress(invocation.contractAddress()).toString(),
    function: invocation.functionName().toString(),
    argsXdr,
    argsSha256: sha256(stable(argsXdr)),
  };
}

function normalizeManifest(value: unknown): AuthorityManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authority manifest must be an object");
  }
  const manifest = value as AuthorityManifest;
  if (
    !hasExactKeys(manifest, [
      "version",
      "network",
      "authorityAccount",
      "requiredSignatures",
      "signers",
    ])
    || manifest.version !== 1
    || !["testnet", "mainnet"].includes(manifest.network)
    || manifest.requiredSignatures !== 2
    || !Array.isArray(manifest.signers)
    || manifest.signers.length !== 3
  ) {
    throw new Error("authority manifest schema is invalid");
  }

  Keypair.fromPublicKey(manifest.authorityAccount);
  const labels = new Set<string>();
  const publicKeys = new Set<string>();
  for (const signer of manifest.signers) {
    if (
      !signer
      || typeof signer !== "object"
      || Array.isArray(signer)
      || !hasExactKeys(signer, SIGNER_KEYS)
      || !["A", "B", "C"].includes(signer.label)
    ) {
      throw new Error("authority signer schema is invalid");
    }
    Keypair.fromPublicKey(signer.publicKey);
    labels.add(signer.label);
    publicKeys.add(signer.publicKey);
  }
  if (labels.size !== 3 || publicKeys.size !== 3) {
    throw new Error("authority signers and labels must be unique");
  }
  if (!publicKeys.has(manifest.authorityAccount)) {
    throw new Error("authority account master key must be one of A/B/C");
  }

  return structuredClone(manifest);
}

function requestPayload(request: SigningRequest): Omit<SigningRequest, "requestId"> {
  const { requestId: _requestId, ...payload } = request;
  return payload;
}

export function createSigningRequest(
  unsignedEnvelopeXdr: string,
  manifestValue: unknown,
): SigningRequest {
  const manifest = normalizeManifest(manifestValue);
  const networkPassphrase = passphraseFor(manifest.network);
  const transaction = parseTransaction(unsignedEnvelopeXdr, networkPassphrase);
  if (transaction.signatures.length !== 0) {
    throw new Error("signing request input must contain zero signatures");
  }
  if (transaction.source !== manifest.authorityAccount) {
    throw new Error("transaction source does not match the authority account");
  }

  const normalizedXdr = transaction.toXDR();
  const request = {
    version: 1,
    requestId: "",
    network: manifest.network,
    networkPassphrase,
    authorityAccount: manifest.authorityAccount,
    requiredSignatures: 2,
    signers: manifest.signers,
    transaction: {
      unsignedEnvelopeXdr: normalizedXdr,
      hash: transaction.hash().toString("hex"),
      source: transaction.source,
      sequence: transaction.sequence,
      fee: transaction.fee,
      timeBounds: transaction.timeBounds ?? null,
      ledgerBounds: transaction.ledgerBounds ?? null,
      effect: extractEffect(transaction),
    },
  } satisfies SigningRequest;

  request.requestId = sha256(stable(requestPayload(request)));
  return request;
}

export function verifySigningRequest(value: unknown): SigningRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("signing request must be an object");
  }
  const request = value as SigningRequest;
  if (
    !hasExactKeys(request, REQUEST_KEYS)
    || !request.transaction
    || typeof request.transaction !== "object"
    || Array.isArray(request.transaction)
    || !hasExactKeys(request.transaction, TRANSACTION_KEYS)
    || !request.transaction.effect
    || typeof request.transaction.effect !== "object"
    || Array.isArray(request.transaction.effect)
    || !hasExactKeys(request.transaction.effect, EFFECT_KEYS)
    || !/^[0-9a-f]{64}$/.test(request.requestId)
  ) {
    throw new Error("signing request schema is invalid");
  }

  const manifest = normalizeManifest({
    version: request.version,
    network: request.network,
    authorityAccount: request.authorityAccount,
    requiredSignatures: request.requiredSignatures,
    signers: request.signers,
  });
  if (request.networkPassphrase !== passphraseFor(manifest.network)) {
    throw new Error("network passphrase does not match the named network");
  }

  const rebuilt = createSigningRequest(
    request.transaction.unsignedEnvelopeXdr,
    manifest,
  );
  if (stable(rebuilt) !== stable(request)) {
    throw new Error("signing request content or requestId does not match its XDR");
  }
  return structuredClone(request);
}

function identifySigner(
  request: SigningRequest,
  transactionHash: Buffer,
  signature: xdr.DecoratedSignature,
): string {
  const bytes = signature.signature();
  const matches = request.signers.filter((signer) => {
    const keypair = Keypair.fromPublicKey(signer.publicKey);
    return (
      keypair.signatureHint().equals(signature.hint())
      && keypair.verify(transactionHash, bytes)
    );
  });
  if (matches.length !== 1) {
    throw new Error("signature is unknown or invalid for this request");
  }
  return matches[0]!.publicKey;
}

export function combineSignedEnvelopes(
  requestValue: unknown,
  signedEnvelopeXdrs: readonly string[],
): CombinedEnvelope {
  const request = verifySigningRequest(requestValue);
  if (signedEnvelopeXdrs.length !== request.requiredSignatures) {
    throw new Error("exactly two independently signed envelopes are required");
  }

  const hash = Buffer.from(request.transaction.hash, "hex");
  const signatures: xdr.DecoratedSignature[] = [];
  const signerPublicKeys: string[] = [];
  for (const envelopeXdr of signedEnvelopeXdrs) {
    const transaction = parseTransaction(envelopeXdr, request.networkPassphrase);
    if (transaction.hash().toString("hex") !== request.transaction.hash) {
      throw new Error("signed envelope belongs to a different request");
    }
    if (transaction.signatures.length !== 1) {
      throw new Error("each signer must return exactly one signature");
    }

    const signature = transaction.signatures[0]!;
    const publicKey = identifySigner(request, hash, signature);
    if (signerPublicKeys.includes(publicKey)) {
      throw new Error("duplicate signer cannot satisfy the threshold");
    }
    signerPublicKeys.push(publicKey);
    signatures.push(signature);
  }

  const ready = parseTransaction(
    request.transaction.unsignedEnvelopeXdr,
    request.networkPassphrase,
  );
  signatures.forEach((signature) => ready.addDecoratedSignature(signature));

  return {
    requestId: request.requestId,
    transactionHash: request.transaction.hash,
    signerPublicKeys: signerPublicKeys as [string, string],
    signedEnvelopeXdr: ready.toXDR(),
  };
}
