import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { loadAppConfig, MAINNET_CONFIRMATION } from "../lib/app-config";

function validEnv(): NodeJS.ProcessEnv {
  const agent = Keypair.random();
  return {
    NODE_ENV: "test",
    REAPP_WALLET_NETWORK: "testnet",
    REAPP_CHAT_AGENT_PUBLIC_KEY: agent.publicKey(),
    REAPP_CHAT_AGENT_SECRET: agent.secret(),
    REAPP_CHAT_MERCHANT_PUBLIC_KEY: Keypair.random().publicKey(),
    REAPP_CHAT_MERCHANT_URL: "https://merchant.example",
    REAPP_SESSION_SECRET: "s".repeat(48),
    OPENAI_API_KEY: "test-only-key",
  };
}

test("testnet becomes ready only with complete matching configuration", () => {
  const config = loadAppConfig(validEnv());
  assert.equal(config.public.ready, true);
  assert.equal(config.public.releaseState, "testnet-ready");
  assert.equal(config.public.wallet.name, "LOBSTR");
  assert.equal(config.public.wallet.authEntrySigning, false);
});

test("agent secret mismatch fails closed without exposing the secret", () => {
  const env = validEnv();
  env.REAPP_CHAT_AGENT_SECRET = Keypair.random().secret();
  const config = loadAppConfig(env);
  assert.equal(config.public.ready, false);
  assert(config.public.blockers.includes("agent signer does not match the public agent address"));
  assert.equal(JSON.stringify(config.public).includes(env.REAPP_CHAT_AGENT_SECRET), false);
});

test("mainnet has no default or testnet fallback", () => {
  const config = loadAppConfig({ ...validEnv(), REAPP_WALLET_NETWORK: "mainnet" });
  assert.equal(config.public.ready, false);
  assert(config.public.blockers.some((item) => item.includes(MAINNET_CONFIRMATION)));
  assert(config.public.blockers.includes("completed mainnet deployment manifest is missing"));
  assert(config.public.blockers.includes("durable DATABASE_URL is required on mainnet"));
  assert.equal(config.public.mandateRegistryId, "");
  assert.equal(config.public.asset.contractId, "");
  assert.equal(config.public.networkPassphrase, Networks.PUBLIC);
});

test("merchant URL and catalog cannot redirect payments off the allowlisted origin", () => {
  const badUrl = loadAppConfig({ ...validEnv(), REAPP_CHAT_MERCHANT_URL: "https://user:pass@merchant.example/path" });
  assert.equal(badUrl.public.ready, false);
  assert(badUrl.public.blockers.includes("REAPP_CHAT_MERCHANT_URL must be a credential-free HTTPS origin"));

  const badCatalog = loadAppConfig({
    ...validEnv(),
    REAPP_CHAT_CATALOG_JSON: JSON.stringify([{ id: "escape", title: "Escape", description: "bad", path: "//evil.example", price: "1.00" }]),
  });
  assert.equal(badCatalog.public.ready, false);
  assert(badCatalog.public.blockers.some((item) => item.includes("safe origin-relative path")));
});
