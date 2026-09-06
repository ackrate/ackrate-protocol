import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { MAINNET_USDC, type ReleaseNetworkConfig } from "@ackrate/stellar";
import { requireMainnetUsdcAuthorization } from "./mainnet-preflight.js";

const user = Keypair.random().publicKey();
const merchant = Keypair.random().publicKey();
const net: ReleaseNetworkConfig = {
  rpcUrl: "https://rpc.example.invalid",
  networkPassphrase: Networks.PUBLIC,
  mandateRegistryId: StrKey.encodeContract(Buffer.alloc(32, 1)),
  nativeSac: StrKey.encodeContract(Buffer.alloc(32, 2)),
  settlementAsset: { ...MAINNET_USDC, decimals: 7 },
  release: { schemaVersion: 2, sourceCommit: "a".repeat(40), deploymentLedger: 1, registryWasmSha256: "b".repeat(64) },
};

test("Mainnet preflight requires the exact user and merchant to be authorized for the manifest USDC", async () => {
  const calls: string[] = [];
  await requireMainnetUsdcAuthorization(net, user, merchant, async (receivedNet, asset, who) => {
    assert.equal(receivedNet, net);
    assert.equal(asset, MAINNET_USDC.contractId);
    calls.push(who);
    return true;
  });
  assert.deepEqual(calls, [user, merchant]);
});

test("Mainnet preflight rejects either deauthorized endpoint even if the other is authorized", async () => {
  for (const [userAuthorized, merchantAuthorized, endpoint] of [
    [false, true, "user"], [true, false, "merchant"], [false, false, "user"],
  ] as const) {
    await assert.rejects(requireMainnetUsdcAuthorization(net, user, merchant,
      async (_net, _asset, who) => who === user ? userAuthorized : merchantAuthorized),
    new RegExp(`mainnet ${endpoint} is not authorized`));
  }
});

test("Mainnet preflight rejects truthy non-boolean authorization instead of allowing registration", async () => {
  for (const invalid of [1, "true", {}, undefined, null]) {
    for (const endpoint of [user, merchant]) {
      await assert.rejects(requireMainnetUsdcAuthorization(net, user, merchant,
        async (_net, _asset, who) => (who === endpoint ? invalid : true) as boolean), /is not authorized/);
    }
  }
});

test("Mainnet preflight preserves missing-trustline and uncertain-RPC failures", async () => {
  for (const message of ["TrustlineMissingError", "RPC request timed out"]) {
    const failure = new Error(message);
    await assert.rejects(requireMainnetUsdcAuthorization(net, user, merchant, async () => { throw failure; }),
      (error) => error === failure);
  }
});

test("both Mainnet entry points await authorization before returning a spend-ready runtime", () => {
  const demo = readFileSync(new URL("./commands/demo.ts", import.meta.url), "utf8");
  const preflight = readFileSync(new URL("./mainnet-preflight.ts", import.meta.url), "utf8");
  const mainnetDemo = demo.slice(demo.indexOf("async function mainnetRuntime("), demo.indexOf("function stableChallengeSecret("));
  const mainnetProject = preflight.slice(preflight.indexOf("export async function mainnetProjectPreflight("));
  for (const source of [mainnetDemo, mainnetProject]) {
    assert.match(source, /await requireMainnetUsdcAuthorization\(net, userSigner\.publicKey, (?:config\.)?merchant\)/);
    assert.ok(source.indexOf("await requireMainnetUsdcAuthorization(") < source.indexOf("return Object.freeze("));
    assert.doesNotMatch(source, /signTransaction\(|sendTransaction\(|registerMandate\(|approveBudget\(/);
    assert.match(source, /await requireMainnetFunding\(server,/);
    assert.ok(source.indexOf("await requireMainnetUsdcAuthorization(") < source.indexOf("await requireMainnetFunding("));
    assert.ok(source.indexOf("await requireMainnetFunding(") < source.indexOf("return Object.freeze("));
  }
  assert.match(demo, /await executeDemo\(network === "mainnet" \? await mainnetRuntime\(options\)/);
});
