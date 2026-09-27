import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { MAINNET, MAINNET_DEPLOYMENT_MANIFEST } from "@ackrate/stellar";
import { loadAppConfig, MAINNET_CONFIRMATION } from "../lib/app-config";
import { ENVIRONMENT_ORIGINS, mandateStorageKey } from "../lib/environment-profiles";

function validEnv(): NodeJS.ProcessEnv {
  const agent = Keypair.random();
  return {
    NODE_ENV: "test",
    ACKRATE_WALLET_NETWORK: "testnet",
    ACKRATE_CHAT_AGENT_PUBLIC_KEY: agent.publicKey(),
    ACKRATE_CHAT_AGENT_SECRET: agent.secret(),
    ACKRATE_CHAT_MERCHANT_PUBLIC_KEY: Keypair.random().publicKey(),
    ACKRATE_CHAT_MERCHANT_URL: "https://merchant.example",
    ACKRATE_SESSION_SECRET: "s".repeat(48),
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
  env.ACKRATE_CHAT_AGENT_SECRET = Keypair.random().secret();
  const config = loadAppConfig(env);
  assert.equal(config.public.ready, false);
  assert(config.public.blockers.includes("agent signer does not match the public agent address"));
  assert.equal(JSON.stringify(config.public).includes(env.ACKRATE_CHAT_AGENT_SECRET), false);
});

test("mainnet uses the official public release but requires independent activation and services", () => {
  const config = loadAppConfig({ ...validEnv(), ACKRATE_WALLET_NETWORK: "mainnet" });
  assert.equal(config.public.ready, false);
  assert(config.public.blockers.some((item) => item.includes(MAINNET_CONFIRMATION)));
  assert(config.public.blockers.includes("durable DATABASE_URL is required on mainnet"));
  assert.equal(config.public.mandateRegistryId, MAINNET.mandateRegistryId);
  assert.equal(config.public.asset.contractId, MAINNET.settlementAsset.contractId);
  assert.equal(config.public.networkPassphrase, Networks.PUBLIC);
  assert.equal(config.public.profile.id, "mainnet");
  assert.equal(config.public.profile.deployment, "production");
});

test("an optional mainnet manifest cannot replace the official release identity", () => {
  const env = { ...validEnv(), ACKRATE_WALLET_NETWORK: "mainnet", ACKRATE_ENABLE_MAINNET: MAINNET_CONFIRMATION,
    ACKRATE_APP_SOURCE_COMMIT: "a".repeat(40), ACKRATE_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet, DATABASE_URL: "postgres://fixture.invalid/sdk" };
  const bundled = loadAppConfig(env);
  assert.equal(bundled.public.ready, true);
  const explicit = loadAppConfig({ ...env, ACKRATE_MAINNET_DEPLOYMENT_MANIFEST_JSON: JSON.stringify(MAINNET_DEPLOYMENT_MANIFEST) });
  assert.equal(explicit.public.ready, true);
  assert.equal(explicit.public.profile.fingerprint, bundled.public.profile.fingerprint);
  const substituted = structuredClone(MAINNET_DEPLOYMENT_MANIFEST);
  Object.assign(substituted.source, { commit: "b".repeat(40) });
  const rejected = loadAppConfig({ ...env, ACKRATE_MAINNET_DEPLOYMENT_MANIFEST_JSON: JSON.stringify(substituted) });
  assert.equal(rejected.public.ready, false);
  assert(rejected.public.blockers.includes("mainnet deployment manifest does not match the published release"));
  assert.equal(rejected.public.mandateRegistryId, MAINNET.mandateRegistryId);
});

test("profiles explicitly map deployment audience and chain and reject conflicting configuration", () => {
  const staging = loadAppConfig({ ...validEnv(), ACKRATE_APP_PROFILE: "staging" });
  assert.equal(staging.public.profile.deployment, "staging");
  assert.equal(staging.public.network, "testnet");
  assert.equal(staging.public.asset.code, "XLM");
  assert.throws(() => loadAppConfig({ ...validEnv(), ACKRATE_APP_PROFILE: "mainnet" }), /disagree/);
  assert.throws(() => loadAppConfig({ ...validEnv(), ACKRATE_APP_PROFILE: "unknown" }), /must be staging or mainnet/);
  assert.throws(() => loadAppConfig({ ...validEnv(), ACKRATE_WALLET_NETWORK: "unknown" }), /must be testnet or mainnet/);
});

test("destination links are opt-in and restricted to the approved HTTPS origins", () => {
  const env = validEnv();
  assert(loadAppConfig(env).public.environments.every((destination) => destination.origin === null));
  const configured = loadAppConfig({ ...env, ACKRATE_STAGING_APP_ORIGIN: ENVIRONMENT_ORIGINS.staging, ACKRATE_MAINNET_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet });
  assert.deepEqual(configured.public.environments.map(({ origin }) => origin), [ENVIRONMENT_ORIGINS.staging, ENVIRONMENT_ORIGINS.mainnet]);
  for (const origin of ["javascript:alert(1)", "http://example.org", "https://attacker.example", `${ENVIRONMENT_ORIGINS.mainnet}/`, `${ENVIRONMENT_ORIGINS.mainnet}?wallet=x`, "https://user:password@example.org"]) {
    const config = loadAppConfig({ ...env, ACKRATE_MAINNET_APP_ORIGIN: origin });
    assert.equal(config.public.environments[1].origin, null);
    assert.equal(config.public.environmentWarnings.length, 1);
    assert.equal(config.public.ready, true, "bad navigation configuration must not disable the current profile");
    assert.equal(JSON.stringify(config.public).includes(origin), false);
  }
  const self = loadAppConfig({ ...env, ACKRATE_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet, ACKRATE_MAINNET_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet });
  assert.equal(self.public.environments[1].origin, null);
});

test("profile fingerprints isolate sessions and caches across authority and origin changes", () => {
  const env = validEnv();
  const original = loadAppConfig(env).public.profile.fingerprint;
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.equal(loadAppConfig({ ...env, ACKRATE_APP_SOURCE_COMMIT: "a".repeat(40), ACKRATE_MAINNET_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet }).public.profile.fingerprint, original);
  for (const changes of [{ ACKRATE_APP_ORIGIN: ENVIRONMENT_ORIGINS.staging }, { ACKRATE_CHAT_MERCHANT_URL: "https://other.example" }, { ACKRATE_CHAT_MERCHANT_PUBLIC_KEY: Keypair.random().publicKey() }, { ACKRATE_CHAT_AGENT_PUBLIC_KEY: Keypair.random().publicKey() }, { ACKRATE_APP_PROFILE: "mainnet", ACKRATE_WALLET_NETWORK: "mainnet" }]) {
    const changed = loadAppConfig({ ...env, ...changes }).public.profile.fingerprint;
    assert.notEqual(changed, original);
    assert.notEqual(mandateStorageKey(changed, "GTEST"), mandateStorageKey(original, "GTEST"));
  }
  assert.notEqual(mandateStorageKey(original, "GONE"), mandateStorageKey(original, "GTWO"));
  assert.notEqual(mandateStorageKey(original, "GTEST"), "ackrate:mandate:testnet:GTEST");
});

test("merchant URL and catalog cannot redirect payments off the allowlisted origin", () => {
  const badUrl = loadAppConfig({ ...validEnv(), ACKRATE_CHAT_MERCHANT_URL: "https://user:pass@merchant.example/path" });
  assert.equal(badUrl.public.ready, false);
  assert(badUrl.public.blockers.includes("ACKRATE_CHAT_MERCHANT_URL must be a credential-free HTTPS origin"));

  const badCatalog = loadAppConfig({
    ...validEnv(),
    ACKRATE_CHAT_CATALOG_JSON: JSON.stringify([{ id: "escape", title: "Escape", description: "bad", path: "//evil.example", price: "1.00" }]),
  });
  assert.equal(badCatalog.public.ready, false);
  assert(badCatalog.public.blockers.some((item) => item.includes("safe origin-relative path")));
});
