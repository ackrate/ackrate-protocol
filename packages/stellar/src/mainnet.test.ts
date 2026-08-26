import assert from "node:assert/strict";
import test from "node:test";
import { Networks } from "@stellar/stellar-sdk";
import { MAINNET } from "./mainnet.js";

test("mainnet release is bound to the verified registry and Circle USDC", () => {
  assert.equal(MAINNET.networkPassphrase, Networks.PUBLIC);
  assert.equal(MAINNET.mandateRegistryId, "CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS");
  assert.equal(MAINNET.settlementAsset.code, "USDC");
  assert.equal(MAINNET.settlementAsset.contractId, "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
  assert.equal(MAINNET.release.registryWasmSha256, "3656430ac7cf5e7cf1c26948b46314c37866c2d7e928ea89d7d1f89b8aa0ef3c");
});
