import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const OLD_REGISTRY = "CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS";
const WR_REGISTRY = "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR";
const USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const AUTHORITY = "GCQNLXZSQUYVFXYTWPA6RF6KIRTGQNZYHR4JIILXE3LTMXZQAUW6PXN5";
const WALLET = "GBE3PH4ZYVYUXZWZL4YJP22H5J46U6VQVF6SYNJ3GGU3RHBN4M77VNBG";
const USER = "GCFH7H3OTPKXLWZFDMPOGUVI4QRIYHX2G5EDRBGAXKTIARBYGDAW4IKN";
const HASHES = [
  "934239bcace9393e2ed0a39f114bf1d45c70e434ab4963a04ee17a132ea3bf8a",
  "dc4ba3ccfe04ee6daabf70e0253226daae4e73ee686db965fe00634b4bdac48b",
  "ba282c06511815319fb204d5e49bbed1ce2e062791032935dbb1031b1c03e90e",
  "64d8e859bbc8ef83030d96402c386f8116addf970ac62c14541bd921c48adfe1",
];

function event(contract, topics, data) {
  return {
    contractId: () => contract,
    body: () => ({ v0: () => ({ topics: () => topics, data: () => data }) }),
  };
}

async function runHistoricalVerifier(paymentRegistry = OLD_REGISTRY) {
  const source = await readFile(new URL("./verify-mainnet-evidence.mjs", import.meta.url), "utf8");
  const output = [];
  const errors = [];
  const requestedHashes = [];
  const process = {};
  // Run the actual auto-executing script with isolated read-only network fixtures.
  // Its two imports are supplied by the context; no live RPC or signing is possible.
  const executable = source.replace(/^import .*;\n/gm, "");
  await runInNewContext(executable, {
    assert: {
      ...assert,
      // RPC JSON and expected literals cross VM realms; compare their data in one realm.
      deepEqual: (actual, expected) => assert.deepEqual(structuredClone(actual), structuredClone(expected)),
    },
    AbortSignal,
    process,
    console: { log: (...items) => output.push(items.join(" ")), error: (...items) => errors.push(items.join(" ")) },
    Networks: { PUBLIC: "Public Global Stellar Network ; September 2015" },
    StrKey: { encodeContract: (contract) => contract },
    scValToNative: (value) => value,
    fetch: async (url) => {
      if (url === `https://horizon.stellar.org/accounts/${AUTHORITY}`) {
        return { ok: true, json: async () => ({
          thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
          signers: ["fixture-a", "fixture-b", "fixture-c"].map((key) => ({ key, type: "ed25519_public_key", weight: 1 })),
        }) };
      }
      assert.equal(url, `https://horizon.stellar.org/accounts/${WALLET}`);
      return { ok: true, json: async () => ({ balances: [{ asset_code: "USDC", asset_issuer: ISSUER }] }) };
    },
    rpc: { Server: class {
      constructor(url) { assert.equal(url, "https://mainnet.sorobanrpc.com"); }
      async getTransaction(hash) {
        const index = HASHES.indexOf(hash);
        assert.ok(index >= 0, "only the recorded historical hashes may be requested");
        requestedHashes.push(hash);
        const from = index === 3 ? WALLET : USER;
        const merchant = index === 3 ? USER : WALLET;
        return {
          status: "SUCCESS",
          ledger: 100 + index,
          events: { contractEventsXdr: [[
            event(USDC, ["transfer", from, merchant, `USDC:${ISSUER}`], 100_000n),
            event(paymentRegistry, ["payment_executed", merchant], { amount: 100_000n }),
          ]] },
        };
      }
    } },
  });
  return { output: output.join("\n"), errors: errors.join("\n"), requestedHashes, exitCode: process.exitCode };
}

test("the old-registry canary verifier labels successful evidence as historical only", async () => {
  const result = await runHistoricalVerifier();
  assert.equal(result.exitCode, undefined, result.errors);
  assert.deepEqual(result.requestedHashes, HASHES);
  assert.match(result.output, new RegExp(`Historical Mainnet canary only: old registry ${OLD_REGISTRY}`));
  assert.match(result.output, /Scope excludes current WR\/V2 and published-CLI reference-agent HTTP acceptance/);
  assert.match(result.output, /Historical Mainnet direct-payment evidence check passed \(old governed registry\)/);
  assert.doesNotMatch(result.output, /Ackrate Mainnet evidence gate passed/);
});

test("current WR events cannot replace the old registry identity in historical evidence", async () => {
  const result = await runHistoricalVerifier(WR_REGISTRY);
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /missing the matching Registry payment event/);
  assert.doesNotMatch(result.output, /check passed/);
  assert.match(result.output, /Historical Mainnet canary only/);
});
