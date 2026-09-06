import { Buffer } from "buffer";
import { Networks, rpc, scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
import { Client, type NetworkConfig } from "@ackrate/stellar";
import type {
  PaymentRequirement,
  PaymentVerifier,
  VerificationResult,
} from "./types.js";

export interface DecodedValue {
  /** Original ScVal discriminant, retained so string/symbol and numeric types cannot blur. */
  type: string;
  value: unknown;
}

export interface DecodedEvent {
  type: string;
  contractId: string | null;
  topics: readonly DecodedValue[];
  data: DecodedValue;
}

export interface PaymentCheck {
  merchant: string;
  registryId: string;
  priceStroops: bigint;
  /** Required to accept a V2 payment's explicit asset topic. */
  asset?: string;
}

interface SelectedPayment {
  amount: bigint;
  mandateId: Buffer;
  /** V2 records the sequence consumed by this payment, before incrementing it. */
  consumedSequence?: number;
}

export type PaymentSelection =
  | ({ ok: true } & SelectedPayment)
  | { ok: false; reason: string };

export interface LoadedTransaction {
  status: string;
  ledger?: number;
  latestLedger?: number;
  events?: readonly DecodedEvent[];
}

export interface LoadedMandate {
  user: string;
  agent: string;
  merchant: string;
  asset: string;
  /** Required for V2 proof verification; older injected legacy loaders may omit these. */
  seq?: number;
  spent?: bigint;
}

const U32_MAX = 0xffff_ffff;
const I128_MAX = (1n << 127n) - 1n;

/** Soroban Address accepts account and contract principals, without normalization. */
function isContractPrincipal(address: string): boolean {
  return typeof address === "string"
    && (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address));
}

export interface StellarVerifierOptions {
  networkConfig: NetworkConfig;
  sourceAccount?: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
  maxProofAgeLedgers?: number;
  allowHttpRpc?: boolean;
  /** Injection points used by deterministic tests and alternate trusted RPC stacks. */
  loadNetworkPassphrase?: () => Promise<string>;
  loadTransaction?: (txHash: string) => Promise<LoadedTransaction>;
  loadMandate?: (mandateId: Buffer) => Promise<LoadedMandate>;
  wait?: (milliseconds: number) => Promise<void>;
}

export function extractContractEvents(meta: xdr.TransactionMeta): xdr.ContractEvent[] {
  try {
    return meta.v4().operations().flatMap((operation) => operation.events());
  } catch {
    try {
      return meta.v3().sorobanMeta()?.events() ?? [];
    } catch {
      throw new Error("unsupported Stellar transaction metadata version");
    }
  }
}

function decodeScVal(value: xdr.ScVal): DecodedValue {
  const type = value.switch().name;
  if (type === "scvVec") {
    return {
      type,
      value: (value.vec() ?? []).map((entry) => decodeScVal(entry)),
    };
  }
  return { type, value: scValToNative(value) as unknown };
}

export function interpretEvents(events: readonly xdr.ContractEvent[]): DecodedEvent[] {
  return events.map((event) => {
    const rawContractId = event.contractId();
    const contractId = rawContractId
      ? StrKey.encodeContract(rawContractId as unknown as Buffer)
      : null;
    try {
      const body = event.body().v0();
      return {
        type: event.type().name,
        contractId,
        topics: body.topics().map((topic) => decodeScVal(topic)),
        data: decodeScVal(body.data()),
      };
    } catch {
      return {
        type: event.type().name,
        contractId,
        topics: [],
        data: { type: "malformed", value: null },
      };
    }
  });
}

function exactValue(value: DecodedValue | undefined, type: string, expected: unknown): boolean {
  return value?.type === type && value.value === expected;
}

function paymentPayload(event: DecodedEvent, v2: boolean): SelectedPayment | undefined {
  if (event.data.type !== "scvVec" || !Array.isArray(event.data.value)) return undefined;
  const values = event.data.value as DecodedValue[];
  if (values.length !== (v2 ? 3 : 2)) return undefined;
  const idValue = values[0];
  const amountValue = values[1];
  if (idValue?.type !== "scvBytes" || amountValue?.type !== "scvI128") return undefined;
  if (!(Buffer.isBuffer(idValue.value) || idValue.value instanceof Uint8Array)) return undefined;
  if (typeof amountValue.value !== "bigint") return undefined;
  const mandateId = Buffer.from(idValue.value);
  if (mandateId.length !== 32 || amountValue.value <= 0n || amountValue.value > I128_MAX) return undefined;
  if (!v2) return { mandateId, amount: amountValue.value };
  const sequence = values[2];
  if (sequence?.type !== "scvU32" || typeof sequence.value !== "number"
    || !Number.isInteger(sequence.value) || sequence.value < 0 || sequence.value >= U32_MAX) return undefined;
  return { mandateId, amount: amountValue.value, consumedSequence: sequence.value };
}

/** Pure, fail-closed selection of one unambiguous registry payment event. */
export function selectPayment(
  decoded: readonly DecodedEvent[],
  check: PaymentCheck,
): PaymentSelection {
  if (decoded.length === 0) {
    return { ok: false, reason: "transaction carried no Soroban contract events" };
  }

  const eligible: SelectedPayment[] = [];
  let largestUnderpayment: bigint | undefined;
  for (const event of decoded) {
    if (event.type !== "contract" || event.contractId !== check.registryId) continue;
    if (!exactValue(event.topics[0], "scvSymbol", "payment")) continue;
    if (!exactValue(event.topics[1], "scvAddress", check.merchant)) continue;
    const v2 = event.topics.length === 3;
    if (event.topics.length !== 2 && !v2) {
      return { ok: false, reason: "registry payment has an unsupported event schema" };
    }
    if (v2 && (!check.asset || !exactValue(event.topics[2], "scvAddress", check.asset))) {
      return { ok: false, reason: "V2 payment asset does not match this API" };
    }
    const payload = paymentPayload(event, v2);
    if (!payload) return { ok: false, reason: "registry payment has malformed typed event fields" };
    if (v2 && payload.amount !== check.priceStroops) {
      return { ok: false, reason: "V2 payment amount does not equal the exact service price" };
    }
    if (payload.amount < check.priceStroops) {
      if (largestUnderpayment === undefined || payload.amount > largestUnderpayment) {
        largestUnderpayment = payload.amount;
      }
      continue;
    }
    eligible.push(payload);
  }

  if (eligible.length > 1) {
    return { ok: false, reason: "transaction contains multiple eligible registry payments" };
  }
  const selected = eligible[0];
  if (selected) return { ok: true, ...selected };
  if (largestUnderpayment !== undefined) {
    return { ok: false, reason: `paid ${largestUnderpayment} stroops, below the price` };
  }
  return { ok: false, reason: "no trusted registry payment to this merchant in that transaction" };
}

export interface TransferCheck {
  asset: string;
  user: string;
  merchant: string;
  amount: bigint;
}

/** Require exactly one matching SEP-41 transfer emitted by the configured asset. */
export function selectTransfer(
  decoded: readonly DecodedEvent[],
  check: TransferCheck,
): { ok: true } | { ok: false; reason: string } {
  let matches = 0;
  for (const event of decoded) {
    if (event.type !== "contract" || event.contractId !== check.asset) continue;
    if (event.topics.length < 3) continue;
    if (!exactValue(event.topics[0], "scvSymbol", "transfer")) continue;
    if (!exactValue(event.topics[1], "scvAddress", check.user)) continue;
    if (!exactValue(event.topics[2], "scvAddress", check.merchant)) continue;
    if (event.data.type !== "scvI128" || event.data.value !== check.amount) continue;
    matches += 1;
  }
  if (matches === 1) return { ok: true };
  if (matches > 1) {
    return { ok: false, reason: "transaction contains multiple matching asset transfers" };
  }
  return { ok: false, reason: "transaction lacks the matching transfer from mandate user to merchant" };
}

function formatStroops(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createStellarPaymentVerifier(options: StellarVerifierOptions): PaymentVerifier {
  const pollAttempts = options.pollAttempts ?? 15;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxProofAgeLedgers = options.maxProofAgeLedgers ?? 120;
  if (!Number.isInteger(pollAttempts) || pollAttempts < 0) {
    throw new Error("pollAttempts must be a non-negative integer.");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("pollIntervalMs must be a non-negative integer.");
  }
  if (!Number.isInteger(maxProofAgeLedgers) || maxProofAgeLedgers < 0) {
    throw new Error("maxProofAgeLedgers must be a non-negative integer.");
  }

  const network = options.networkConfig;
  let rpcUrl: URL;
  try {
    rpcUrl = new URL(network.rpcUrl);
  } catch {
    throw new Error("networkConfig.rpcUrl must be an absolute URL.");
  }
  const allowHttp = options.allowHttpRpc === true;
  if (rpcUrl.protocol !== "https:" && !(allowHttp && rpcUrl.protocol === "http:")) {
    throw new Error("RPC must use https:// unless allowHttpRpc is explicitly enabled for development.");
  }

  const server = new rpc.Server(network.rpcUrl, { allowHttp });
  const loadNetworkPassphrase = options.loadNetworkPassphrase
    ?? (async () => (await server.getNetwork()).passphrase);
  const defaultTransactionLoader = async (txHash: string): Promise<LoadedTransaction> => {
    const transaction = await server.getTransaction(txHash);
    if (transaction.status !== "SUCCESS") {
      return {
        status: transaction.status,
        latestLedger: transaction.latestLedger,
        ledger: "ledger" in transaction ? transaction.ledger : undefined,
      };
    }
    return {
      status: transaction.status,
      ledger: transaction.ledger,
      latestLedger: transaction.latestLedger,
      events: interpretEvents(extractContractEvents(transaction.resultMetaXdr)),
    };
  };

  let defaultMandateLoader: ((mandateId: Buffer) => Promise<LoadedMandate>) | undefined;
  if (!options.loadMandate) {
    if (!options.sourceAccount || !StrKey.isValidEd25519PublicKey(options.sourceAccount)) {
      throw new Error("sourceAccount must be a funded Stellar account address (G...).");
    }
    const refuseSigning = async (): Promise<never> => {
      throw new Error("Ackrate payment verification is read-only and never signs.");
    };
    const client = new Client({
      contractId: network.mandateRegistryId,
      rpcUrl: network.rpcUrl,
      networkPassphrase: network.networkPassphrase,
      publicKey: options.sourceAccount,
      signTransaction: refuseSigning,
      allowHttp,
    });
    defaultMandateLoader = async (mandateId: Buffer): Promise<LoadedMandate> => {
      const mandate = (await client.get_mandate({ mandate_id: mandateId })).result.unwrap();
      return {
        user: mandate.user,
        agent: mandate.agent,
        merchant: mandate.merchant,
        asset: mandate.asset,
        seq: mandate.seq,
        spent: mandate.spent,
      };
    };
  }

  const loadTransaction = options.loadTransaction ?? defaultTransactionLoader;
  const loadMandate = options.loadMandate ?? defaultMandateLoader;
  if (!loadMandate) throw new Error("loadMandate or sourceAccount is required.");
  const wait = options.wait ?? defaultWait;

  return {
    async verify(txHash: string, requirement: PaymentRequirement): Promise<VerificationResult> {
      const normalizedTxHash = txHash.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalizedTxHash)) {
        return { ok: false, kind: "invalid", reason: "proof transaction hash is not 64 hex characters" };
      }
      const expectedNetwork = network.networkPassphrase === Networks.PUBLIC ? "stellar-mainnet"
        : network.networkPassphrase === Networks.TESTNET ? "stellar-testnet" : undefined;
      if (requirement.registryId !== network.mandateRegistryId
        || (expectedNetwork && requirement.network !== expectedNetwork)) {
        return { ok: false, kind: "invalid", reason: "payment requirement does not match the configured registry and network" };
      }

      try {
        const rpcPassphrase = await loadNetworkPassphrase();
        if (rpcPassphrase !== network.networkPassphrase) {
          return { ok: false, kind: "unavailable", reason: "RPC network passphrase does not match configuration" };
        }
      } catch (error) {
        return {
          ok: false,
          kind: "unavailable",
          reason: `RPC network identity read failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      let transaction: LoadedTransaction | undefined;
      try {
        for (let attempt = 0; attempt <= pollAttempts; attempt += 1) {
          transaction = await loadTransaction(normalizedTxHash);
          if (transaction.status !== "NOT_FOUND") break;
          if (attempt < pollAttempts) await wait(pollIntervalMs);
        }
      } catch (error) {
        return {
          ok: false,
          kind: "unavailable",
          reason: `transaction RPC read failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!transaction || transaction.status === "NOT_FOUND") {
        return { ok: false, kind: "unavailable", reason: "transaction was not found before the verification timeout" };
      }
      if (transaction.status !== "SUCCESS") {
        return { ok: false, kind: "invalid", reason: `transaction is ${transaction.status}, not SUCCESS` };
      }
      if (!Number.isSafeInteger(transaction.ledger) || !Number.isSafeInteger(transaction.latestLedger)) {
        return { ok: false, kind: "unavailable", reason: "RPC omitted safe transaction freshness ledger numbers" };
      }
      const ledger = transaction.ledger as number;
      const latestLedger = transaction.latestLedger as number;
      if (ledger > latestLedger) {
        return { ok: false, kind: "unavailable", reason: "transaction ledger is ahead of the RPC latest ledger" };
      }
      if (latestLedger - ledger > maxProofAgeLedgers) {
        return { ok: false, kind: "invalid", reason: "transaction is outside the accepted proof freshness window" };
      }

      const events = transaction.events ?? [];
      const selected = selectPayment(events, {
        merchant: requirement.merchant,
        registryId: requirement.registryId,
        priceStroops: requirement.amountStroops,
        asset: requirement.asset,
      });
      if (selected.ok === false) return { ok: false, kind: "invalid", reason: selected.reason };

      let mandate: LoadedMandate;
      try {
        mandate = await loadMandate(selected.mandateId);
      } catch (error) {
        return {
          ok: false,
          kind: "unavailable",
          reason: `mandate read failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (mandate.merchant !== requirement.merchant) {
        return { ok: false, kind: "invalid", reason: "stored mandate merchant does not match this API" };
      }
      if (mandate.asset !== requirement.asset) {
        return { ok: false, kind: "invalid", reason: "stored mandate asset does not match this API" };
      }
      if (selected.consumedSequence !== undefined) {
        if (!isContractPrincipal(mandate.user) || !isContractPrincipal(mandate.merchant)
          || !StrKey.isValidEd25519PublicKey(mandate.agent)) {
          return { ok: false, kind: "invalid", reason: "V2 mandate contains an invalid user or merchant address, or an invalid Ed25519 agent" };
        }
        if (typeof mandate.seq !== "number" || !Number.isInteger(mandate.seq)
          || mandate.seq < 1 || mandate.seq > U32_MAX || mandate.seq <= selected.consumedSequence
          || typeof mandate.spent !== "bigint" || mandate.spent < selected.amount || mandate.spent > I128_MAX) {
          return { ok: false, kind: "invalid", reason: "on-chain mandate does not confirm the V2 payment amount and consumed sequence" };
        }
      }

      const transfer = selectTransfer(events, {
        asset: mandate.asset,
        user: mandate.user,
        merchant: mandate.merchant,
        amount: selected.amount,
      });
      if (transfer.ok === false) return { ok: false, kind: "invalid", reason: transfer.reason };

      return {
        ok: true,
        payment: {
          txHash: normalizedTxHash,
          ledger,
          mandateId: selected.mandateId.toString("hex"),
          user: mandate.user,
          agent: mandate.agent,
          amount: formatStroops(selected.amount, requirement.decimals),
          amountStroops: selected.amount,
          merchant: mandate.merchant,
          asset: mandate.asset,
          registryId: requirement.registryId,
          scheme: requirement.scheme,
          network: requirement.network,
        },
      };
    },
  };
}
