import { Buffer } from "node:buffer";
import { type IntentMandate } from "@ackrate/core";
import { MAINNET, registryClient, type Mandate, type NetworkConfig, type StellarSigner } from "@ackrate/stellar";
import { Address, Keypair, Transaction, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface SetupResumeScope {
  user: string; agent: string; merchant: string; asset: string;
  maxAmount: bigint; decimals: number;
}
export interface SetupResumeReads {
  getNetwork(): Promise<unknown>;
  getTransaction(hash: string): Promise<unknown>;
  getPayerAccount(): Promise<xdr.AccountEntry>;
  getMandate(id: Buffer): Promise<Mandate>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Setup registration evidence is malformed");
  return value as Record<string, unknown>;
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
function closeTime(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return positive(parsed) ? parsed : NaN;
}

/** Recover only an exact successful, unused registration. No signer is called
 * here; this does not recover payments or permit replacing a mandate. */
export async function recoverSetupRegistration(
  hash: string, scope: SetupResumeScope, net: NetworkConfig, signer: StellarSigner,
  reads?: SetupResumeReads, now = Math.floor(Date.now() / 1000),
): Promise<IntentMandate> {
  const expected = { ...scope };
  if (!/^[a-f0-9]{64}$/.test(hash) || !positive(now)
    || net.networkPassphrase !== MAINNET.networkPassphrase || net.mandateRegistryId !== MAINNET.mandateRegistryId
    || expected.asset !== MAINNET.settlementAsset.contractId || signer.publicKey !== expected.user
    || expected.maxAmount <= 0n || expected.decimals !== MAINNET.settlementAsset.decimals) {
    throw new Error("Setup registration resume requires the exact Mainnet scope and transaction hash");
  }
  const server = new rpc.Server(net.rpcUrl);
  server.httpClient.defaults.timeout = 10_000;
  server.httpClient.defaults.maxContentLength = 1024 * 1024;
  server.httpClient.defaults.maxRedirects = 0;
  const client = registryClient(net, signer);
  const source = reads ?? {
    getNetwork: () => server.getNetwork(),
    getTransaction: (txHash: string) => server.getTransaction(txHash),
    getPayerAccount: () => server.getAccountEntry(expected.user),
    getMandate: async (id: Buffer) => (await client.get_mandate({ mandate_id: id })).result.unwrap(),
  };
  const network = record(await source.getNetwork());
  if (network.passphrase !== MAINNET.networkPassphrase || "error" in network) throw new Error("Setup registration RPC is not Mainnet");
  const found = record(await source.getTransaction(hash));
  // RPC emits this u64 as a decimal string despite the SDK response type.
  const latestClosedAt = closeTime(found.latestLedgerCloseTime);
  if (found.status !== "SUCCESS" || found.txHash !== hash || found.feeBump !== false
    || !positive(found.ledger) || found.ledger > 0xffff_ffff
    || !positive(found.latestLedger) || found.latestLedger > 0xffff_ffff || found.latestLedger < found.ledger
    || !positive(latestClosedAt) || latestClosedAt > now || now - latestClosedAt > 120
    || !(found.envelopeXdr instanceof xdr.TransactionEnvelope) || !(found.returnValue instanceof xdr.ScVal)) {
    throw new Error("Setup registration is not an exact fresh confirmed success");
  }
  let tx: Transaction; let expiry: number; let credential: Buffer; let id: Buffer;
  try {
    const parsed = TransactionBuilder.fromXDR(found.envelopeXdr, net.networkPassphrase);
    if (!(parsed instanceof Transaction) || parsed.source !== expected.user || parsed.hash().toString("hex") !== hash
      || !/^[1-9][0-9]*$/.test(parsed.sequence) || parsed.operations.length !== 1) throw new Error();
    const operation = parsed.operations[0];
    if (!operation || operation.type !== "invokeHostFunction" || (operation.source && operation.source !== expected.user)
      || operation.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error();
    const invocation = operation.func.invokeContract();
    if (Address.fromScAddress(invocation.contractAddress()).toString() !== net.mandateRegistryId
      || invocation.functionName().toString() !== "register_mandate" || invocation.args().length !== 7) throw new Error();
    const [user, agent, merchant, asset, maxAmount, expiryValue, credentialValue] = invocation.args().map(scValToNative);
    if (user !== expected.user || agent !== expected.agent || merchant !== expected.merchant || asset !== expected.asset
      || maxAmount !== expected.maxAmount || typeof expiryValue !== "bigint" || expiryValue <= BigInt(now)
      || expiryValue > BigInt(Number.MAX_SAFE_INTEGER) || !(credentialValue instanceof Uint8Array) || credentialValue.length !== 32) throw new Error();
    const returned = scValToNative(found.returnValue);
    if (!(returned instanceof Uint8Array) || returned.length !== 32) throw new Error();
    // Re-encode with the actual published WR ABI to reject incorrect ScVal types.
    const canonical = client.spec.funcArgsToScVals("register_mandate", { user, agent, merchant, asset,
      max_amount: maxAmount, expiry: expiryValue, vc_hash: Buffer.from(credentialValue) });
    if (canonical.some((value, index) => !value.toXDR().equals(invocation.args()[index]!.toXDR()))) throw new Error();
    tx = parsed; expiry = Number(expiryValue); credential = Buffer.from(credentialValue); id = Buffer.from(returned);
  } catch { throw new Error("Setup registration transaction, policy, or returned mandate ID differs"); }
  const [payer, chain] = await Promise.all([source.getPayerAccount(), source.getMandate(id)]);
  if (!(payer instanceof xdr.AccountEntry)
    || !payer.accountId().toXDR().equals(Keypair.fromPublicKey(expected.user).xdrAccountId().toXDR())
    || payer.seqNum().toString() !== tx.sequence) throw new Error("Setup registration payer sequence changed; resume is refused");
  if (chain.user !== expected.user || chain.agent !== expected.agent || chain.merchant !== expected.merchant
    || chain.asset !== expected.asset || chain.max_amount !== expected.maxAmount || chain.expiry !== BigInt(expiry)
    || chain.seq !== 0 || chain.spent !== 0n || chain.status?.tag !== "Active"
    || !(chain.vc_hash instanceof Uint8Array) || !Buffer.from(chain.vc_hash).equals(credential)) {
    throw new Error("Setup registration mandate is used, revoked, or has a different credential or scope");
  }
  return { id: id.toString("hex"), idBuffer: id, credentialHash: credential.toString("hex"),
    ...expected, expiry };
}
