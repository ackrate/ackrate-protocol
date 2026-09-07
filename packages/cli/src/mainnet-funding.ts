import { Asset, StrKey, rpc, xdr } from "@stellar/stellar-sdk";

const I64_MAX = (1n << 63n) - 1n;
const MINIMUM_SPENDABLE_XLM = 5_000_000n;

function amount(value: { toString(): string }, label: string): bigint {
  const text = value.toString();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`invalid ${label} in funding RPC response`);
  const parsed = BigInt(text);
  if (parsed > I64_MAX) throw new Error(`invalid ${label} in funding RPC response`);
  return parsed;
}

function count(value: number, label: string): bigint {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`invalid ${label} in funding RPC response`);
  }
  return BigInt(value);
}

function accountMatches(account: xdr.AccountId, expected: string): void {
  if (!StrKey.isValidEd25519PublicKey(expected)
    || StrKey.encodeEd25519PublicKey(account.ed25519()) !== expected) {
    throw new Error("funding RPC returned a different account");
  }
}

/** Same reserve and liability floor used by the Stellar Asset Contract. */
export function nativeFunding(entry: xdr.AccountEntry, address: string, baseReserve: number) {
  xdr.AccountEntry.fromXDR(entry.toXDR()); // Reject malformed or unsupported XDR.
  accountMatches(entry.accountId(), address);
  const reserve = count(baseReserve, "base reserve");
  if (reserve === 0n) throw new Error("funding RPC base reserve must be positive");
  const balance = amount(entry.balance(), "native balance");
  let units = 2n + count(entry.numSubEntries(), "subentry count");
  let selling = 0n;
  if (entry.ext().switch() === 1) {
    const extension = entry.ext().v1();
    selling = amount(extension.liabilities().selling(), "native selling liabilities");
    amount(extension.liabilities().buying(), "native buying liabilities");
    if (extension.ext().switch() === 2) {
      const sponsorship = extension.ext().v2();
      units += count(sponsorship.numSponsoring(), "sponsoring count")
        - count(sponsorship.numSponsored(), "sponsored count");
    } else if (extension.ext().switch() !== 0) throw new Error("unsupported account extension");
  } else if (entry.ext().switch() !== 0) throw new Error("unsupported account extension");
  if (units < 0n) throw new Error("invalid sponsored reserve in funding RPC response");
  return { balance, spendable: balance - reserve * units - selling };
}

/** Full authorization is required; maintain-liabilities-only cannot transfer. */
export function creditFunding(entry: xdr.TrustLineEntry, address: string, asset: Asset) {
  xdr.TrustLineEntry.fromXDR(entry.toXDR());
  accountMatches(entry.accountId(), address);
  if (!entry.asset().toXDR().equals(asset.toTrustLineXDRObject().toXDR())) {
    throw new Error("funding RPC returned a different trustline asset");
  }
  const flags = count(entry.flags(), "trustline flags");
  if ((flags & 1n) === 0n) throw new Error("mainnet USDC trustline is not authorized for transfers");
  const balance = amount(entry.balance(), "USDC balance");
  const limit = amount(entry.limit(), "USDC trustline limit");
  let buying = 0n;
  let selling = 0n;
  if (entry.ext().switch() === 1) {
    buying = amount(entry.ext().v1().liabilities().buying(), "USDC buying liabilities");
    selling = amount(entry.ext().v1().liabilities().selling(), "USDC selling liabilities");
  } else if (entry.ext().switch() !== 0) throw new Error("unsupported trustline extension");
  if (balance > limit || selling > balance || buying > limit - balance) {
    throw new Error("invalid USDC trustline capacity in funding RPC response");
  }
  return { balance, sendable: balance - selling, receivable: limit - balance - buying };
}

/** A read-only preflight snapshot, not a reservation or a guarantee of future fees. */
export async function requireMainnetFunding(
  server: Pick<rpc.Server, "getAccountEntry" | "getTrustline" | "getLatestLedger">,
  asset: Asset,
  user: string,
  agent: string,
  merchant: string,
  requiredUsdc: bigint,
  minimumUserSpendableXlm = MINIMUM_SPENDABLE_XLM,
) {
  if (requiredUsdc <= 0n || requiredUsdc > I64_MAX) throw new Error("required USDC must be a positive i64 amount");
  if (minimumUserSpendableXlm !== MINIMUM_SPENDABLE_XLM && minimumUserSpendableXlm !== 500_000n) {
    throw new Error("unsupported Mainnet payer fee floor");
  }
  const [latest, userAccount, agentAccount, merchantAccount, userLine, merchantLine] = await Promise.all([
    server.getLatestLedger(), server.getAccountEntry(user), server.getAccountEntry(agent),
    server.getAccountEntry(merchant), server.getTrustline(user, asset), server.getTrustline(merchant, asset),
  ]);
  if (!Number.isSafeInteger(latest.sequence) || latest.sequence <= 0
    || latest.headerXdr.ledgerSeq() !== latest.sequence) throw new Error("invalid latest ledger in funding RPC response");
  xdr.AccountEntry.fromXDR(merchantAccount.toXDR());
  accountMatches(merchantAccount.accountId(), merchant);
  const userNative = nativeFunding(userAccount, user, latest.headerXdr.baseReserve());
  const agentNative = nativeFunding(agentAccount, agent, latest.headerXdr.baseReserve());
  const userCredit = creditFunding(userLine, user, asset);
  const merchantCredit = creditFunding(merchantLine, merchant, asset);
  if (userNative.spendable < minimumUserSpendableXlm || agentNative.spendable < MINIMUM_SPENDABLE_XLM) {
    throw new Error(minimumUserSpendableXlm === MINIMUM_SPENDABLE_XLM
      ? "mainnet user and agent must each have at least 0.50 spendable XLM above reserves, sponsorship obligations, and selling liabilities for fees"
      : "resumed Mainnet setup requires at least 0.05 payer and 0.50 agent spendable XLM above reserves and liabilities for fees");
  }
  if (userCredit.sendable < requiredUsdc) throw new Error("mainnet user spendable USDC is below the required amount after selling liabilities");
  if (merchantCredit.receivable < requiredUsdc) throw new Error("mainnet merchant USDC receive capacity is below the required amount after trustline limits and buying liabilities");
  return Object.freeze({ userUsdc: userCredit.balance, userXlm: userNative.balance, agentXlm: agentNative.balance,
    userSpendableXlm: userNative.spendable, agentSpendableXlm: agentNative.spendable,
    userUsdcSendable: userCredit.sendable, merchantUsdcReceivable: merchantCredit.receivable });
}
