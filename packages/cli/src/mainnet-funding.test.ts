import assert from "node:assert/strict";
import test from "node:test";
import { Asset, Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { creditFunding, nativeFunding, requireMainnetFunding } from "./mainnet-funding.js";

const users = [11, 12, 13, 14].map((byte) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte)));
const [user, agent, merchant, issuer] = users.map((key) => key.publicKey()) as [string, string, string, string];
const asset = new Asset("USDC", issuer);
const i64 = (value: bigint) => xdr.Int64.fromString(value.toString());
const liabilities = (buying = 0n, selling = 0n) => new xdr.Liabilities({ buying: i64(buying), selling: i64(selling) });

function account(address: string, options: { balance?: bigint; sponsored?: number; sponsoring?: number; selling?: bigint; subentries?: number; legacy?: boolean } = {}) {
  return new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(address).xdrAccountId(), balance: i64(options.balance ?? 50_000_000n),
    seqNum: xdr.SequenceNumber.fromString("1"), numSubEntries: options.subentries ?? 1,
    inflationDest: null, flags: 0, homeDomain: "", thresholds: Buffer.from([1, 0, 0, 0]), signers: [],
    ext: options.legacy ? new xdr.AccountEntryExt(0) : new xdr.AccountEntryExt(1, new xdr.AccountEntryExtensionV1({
      liabilities: liabilities(0n, options.selling),
      ext: new xdr.AccountEntryExtensionV1Ext(2, new xdr.AccountEntryExtensionV2({
        numSponsored: options.sponsored ?? 0, numSponsoring: options.sponsoring ?? 0,
        signerSponsoringIDs: [], ext: new xdr.AccountEntryExtensionV2Ext(0),
      })),
    })),
  });
}

function line(address: string, options: { balance?: bigint; limit?: bigint; buying?: bigint; selling?: bigint; flags?: number; otherAsset?: Asset; legacy?: boolean } = {}) {
  return new xdr.TrustLineEntry({
    accountId: Keypair.fromPublicKey(address).xdrAccountId(), asset: (options.otherAsset ?? asset).toTrustLineXDRObject(),
    balance: i64(options.balance ?? 30_000_000n), limit: i64(options.limit ?? 100_000_000n), flags: options.flags ?? 1,
    ext: options.legacy ? new xdr.TrustLineEntryExt(0) : new xdr.TrustLineEntryExt(1, new xdr.TrustLineEntryV1({
      liabilities: liabilities(options.buying, options.selling), ext: new xdr.TrustLineEntryV1Ext(0),
    })),
  });
}

test("native spendable balance subtracts reserve, sponsorship obligations, and selling liabilities", () => {
  assert.deepEqual(nativeFunding(account(user, { balance: 40_000_000n, sponsored: 2, sponsoring: 4, selling: 2_000_000n }), user, 5_000_000),
    { balance: 40_000_000n, spendable: 13_000_000n });
  assert.equal(nativeFunding(account(user, { legacy: true }), user, 5_000_000).spendable, 35_000_000n);
  assert.equal(nativeFunding(account(user, { sponsored: 3 }), user, 5_000_000).spendable, 50_000_000n);
  assert.equal(nativeFunding(account(user), user, 6_000_000).spendable, 32_000_000n);
});

test("USDC capacities subtract selling and buying liabilities from balance and limit", () => {
  assert.deepEqual(creditFunding(line(user, { buying: 20_000_000n, selling: 5_000_000n }), user, asset),
    { balance: 30_000_000n, sendable: 25_000_000n, receivable: 50_000_000n });
  assert.equal(creditFunding(line(user, { legacy: true }), user, asset).sendable, 30_000_000n);
  for (const flags of [0, 2]) assert.throws(() => creditFunding(line(user, { flags }), user, asset), /not authorized/);
});

test("funding calculations reject malformed numeric values, wrong identities, and wrong assets", () => {
  assert.throws(() => nativeFunding(account(user), agent, 5_000_000), /different account/);
  for (const reserve of [0, -1, Number.NaN, 0.5]) assert.throws(() => nativeFunding(account(user), user, reserve));
  assert.throws(() => nativeFunding(account(user, { sponsored: 4 }), user, 5_000_000), /invalid sponsored reserve/);
  assert.throws(() => nativeFunding(account(user, { balance: -1n }), user, 5_000_000), /invalid native balance/);
  assert.throws(() => creditFunding(line(user), merchant, asset), /different account/);
  assert.throws(() => creditFunding(line(user, { otherAsset: new Asset("USD", issuer) }), user, asset), /different trustline asset/);
  for (const options of [{ balance: -1n }, { balance: 101_000_000n }, { selling: 31_000_000n }, { buying: 71_000_000n }]) {
    assert.throws(() => creditFunding(line(user, options), user, asset));
  }
});

function server(options: { userAccount?: xdr.AccountEntry; agentAccount?: xdr.AccountEntry; userLine?: xdr.TrustLineEntry; merchantLine?: xdr.TrustLineEntry; malformedLedger?: boolean } = {}) {
  return {
    getLatestLedger: async () => ({ sequence: 100, headerXdr: { ledgerSeq: () => options.malformedLedger ? 99 : 100, baseReserve: () => 5_000_000 } }),
    getAccountEntry: async (address: string) => address === user ? options.userAccount ?? account(user)
      : address === agent ? options.agentAccount ?? account(agent) : account(merchant),
    getTrustline: async (address: string, requestedAsset: Asset) => {
      assert.equal(requestedAsset.toString(), asset.toString());
      return address === user ? options.userLine ?? line(user) : options.merchantLine ?? line(merchant);
    },
  } as unknown as Pick<rpc.Server, "getAccountEntry" | "getTrustline" | "getLatestLedger">;
}

test("read-only funding preflight requires fee headroom and both USDC capacities", async () => {
  assert.equal((await requireMainnetFunding(server(), asset, user, agent, merchant, 3_000_000n)).userSpendableXlm, 35_000_000n);
  for (const fixture of [server({ userAccount: account(user, { balance: 19_999_999n }) }),
    server({ agentAccount: account(agent, { balance: 20_000_000n, selling: 1n }) })]) {
    await assert.rejects(requireMainnetFunding(fixture, asset, user, agent, merchant, 3_000_000n), /spendable XLM/);
  }
  await assert.rejects(requireMainnetFunding(server({ userLine: line(user, { selling: 28_000_001n }) }), asset, user, agent, merchant, 3_000_000n), /spendable USDC/);
  await assert.rejects(requireMainnetFunding(server({ merchantLine: line(merchant, { buying: 68_000_001n }) }), asset, user, agent, merchant, 3_000_000n), /receive capacity/);
  await assert.rejects(requireMainnetFunding(server({ malformedLedger: true }), asset, user, agent, merchant, 3_000_000n), /invalid latest ledger/);
  await assert.rejects(requireMainnetFunding({ ...server(), getTrustline: async () => { throw new Error("missing trustline"); } }, asset, user, agent, merchant, 3_000_000n), /missing trustline/);
});

test("explicit setup resume lowers only payer fee floor; normal runs and agent headroom remain unchanged", async () => {
  const partiallySpent = server({ userAccount: account(user, { balance: 19_686_928n }) });
  await assert.rejects(requireMainnetFunding(partiallySpent, asset, user, agent, merchant, 300_000n), /0.50/);
  assert.equal((await requireMainnetFunding(partiallySpent, asset, user, agent, merchant, 300_000n, 500_000n)).userSpendableXlm, 4_686_928n);
  await assert.rejects(requireMainnetFunding(server({ userAccount: account(user, { balance: 15_499_999n }) }),
    asset, user, agent, merchant, 300_000n, 500_000n), /0.05 payer/);
  await assert.rejects(requireMainnetFunding(server({ agentAccount: account(agent, { balance: 19_999_999n }) }),
    asset, user, agent, merchant, 300_000n, 500_000n), /0.50 agent/);
  for (const floor of [0n, 1n, 499_999n, 10_000_000n]) {
    await assert.rejects(requireMainnetFunding(server(), asset, user, agent, merchant, 300_000n, floor), /unsupported/);
  }
});
