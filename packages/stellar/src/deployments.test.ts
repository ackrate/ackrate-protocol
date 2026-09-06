import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Asset, Networks, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";

import { Client, networks } from "./client.js";
import { Client as LegacyClient, networks as legacyNetworks } from "./legacy-client.js";
import { MAINNET, TESTNET } from "./config.js";
import { DEPLOYMENTS, MAINNET_DEPLOYMENT_MANIFEST, publishedMainnetNetworkFromDeploymentManifest } from "./deployments.js";
import { MAINNET_USDC } from "./release-manifest.js";
import { registryClient } from "./registry.js";

const PERMANENT_TESTNET_REGISTRY =
  "CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM";

test("all published testnet defaults use the permanent upgradable contract", () => {
  assert.equal(DEPLOYMENTS.testnet.mandateRegistryId, PERMANENT_TESTNET_REGISTRY);
  assert.equal(TESTNET.mandateRegistryId, PERMANENT_TESTNET_REGISTRY);
  assert.equal(legacyNetworks.testnet.contractId, PERMANENT_TESTNET_REGISTRY);
});

function publishedManifest() {
  const release = DEPLOYMENTS.mainnet;
  return {
    schema_version: 2,
    network: { name: "mainnet", passphrase: Networks.PUBLIC, rpc_url: "https://rpc.example.test" },
    source: { repository: release.sourceRepository, directory: release.sourceDirectory, package: "mandate-registry",
      version: release.sourceVersion as string, commit: release.sourceCommit as string, dirty: false },
    artifacts: { mandate_registry: { sha256: release.registryWasmSha256 as string,
      interface_sha256: release.registryInterfaceSha256 as string, size_bytes: release.registryWasmSizeBytes as number } },
    public_configuration: { deployment_source_account: release.authorityAccount as string,
      authority_2_of_3_account: release.authorityAccount as string, usdc_asset_code: MAINNET_USDC.code,
      usdc_issuer: MAINNET_USDC.issuer, usdc_sac: MAINNET_USDC.contractId,
      usdc_derivation_evidence: "Local fixture: canonical asset derivation", usdc_independent_verifier: "Local fixture" },
    constructor_arguments: { admin: release.authorityAccount as string, initial_asset: MAINNET_USDC.contractId },
    deployment: { authorized_by: "Local fixture for published deployment identity", deployed_at: "2026-08-31T11:34:37.000Z",
      ledger: release.deploymentLedger as number, wasm_upload_transaction_hash: release.wasmUploadTransactionHash as string,
      registry_transaction_hash: release.deploymentTransactionHash as string, registry_contract_id: release.mandateRegistryId as string,
      registry_observed_wasm_hash: release.registryWasmSha256 as string },
    verification: { artifact_hashes_match: true, constructor_arguments_match: true, registry_admin_is_2_of_3: true,
      registry_pending_admin_is_none: true, registry_schema_version_is_2: true, registry_initially_unpaused: true,
      registry_usdc_asset_allowed: true, authority_has_three_weight_one_signers: true, authority_thresholds_are_2_of_3: true,
      independent_read_only_verifier: "Local fixture only; no live read", verified_at: "2026-09-01T13:07:18.000Z" },
  };
}

test("published Mainnet identity is pinned while explicit legacy network remains distinct", () => {
  assert.equal(DEPLOYMENTS.mainnet.mandateRegistryId, "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR");
  assert.equal(DEPLOYMENTS.mainnet.nativeSac, Asset.native().contractId(Networks.PUBLIC));
  assert.equal(DEPLOYMENTS.mainnet.settlementAsset, MAINNET_USDC);
  assert.equal(DEPLOYMENTS.mainnet.registryWasmSha256, "982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62");
  assert.equal(DEPLOYMENTS.mainnet.registryInterfaceSha256, "69c201ce1fb089ccfef06f125826b0aeba72af1b1536cb0b19e8cb05970ee805");
  assert.equal(TESTNET.mandateRegistryId, PERMANENT_TESTNET_REGISTRY);
  assert.equal("rpcUrl" in DEPLOYMENTS.mainnet, false, "deployment metadata is not an implicit spend-ready NetworkConfig");
  assert.equal(Object.isFrozen(DEPLOYMENTS.mainnet), true);
  assert.equal(Object.isFrozen(DEPLOYMENTS), true, "the published Mainnet profile cannot be replaced at runtime");
});

test("official Mainnet is ready to use from its complete bundled public deployment evidence", () => {
  assert.equal(MAINNET.mandateRegistryId, "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR");
  assert.equal(MAINNET.networkPassphrase, Networks.PUBLIC);
  assert.equal(MAINNET.rpcUrl, "https://mainnet.sorobanrpc.com");
  assert.equal(MAINNET.settlementAsset.contractId, MAINNET_USDC.contractId);
  assert.equal(MAINNET.settlementAsset.decimals, 7);
  assert.equal(networks.mainnet.contractId, MAINNET.mandateRegistryId);
  assert.equal(networks.mainnet.networkPassphrase, MAINNET.networkPassphrase);
  assert.deepEqual(MAINNET, publishedMainnetNetworkFromDeploymentManifest(MAINNET_DEPLOYMENT_MANIFEST));
  assert.notEqual(MAINNET.mandateRegistryId, TESTNET.mandateRegistryId);
  assert.notEqual(MAINNET.networkPassphrase, TESTNET.networkPassphrase);
  assert.equal(Object.isFrozen(MAINNET), true);
  assert.equal(Object.isFrozen(MAINNET.release), true);
  assert.equal(Object.isFrozen(MAINNET.settlementAsset), true);
  assert.equal(Object.isFrozen(networks), true);
  assert.equal(Object.isFrozen(networks.mainnet), true);
  assert.equal(Reflect.set(networks.mainnet, "contractId", TESTNET.mandateRegistryId), false);
  assert.equal(Reflect.set(MAINNET, "mandateRegistryId", TESTNET.mandateRegistryId), false);
  assert.equal(Reflect.set(MAINNET.settlementAsset, "contractId", TESTNET.nativeSac), false);
  assert.equal(Reflect.set(MAINNET.release, "registryWasmSha256", "a".repeat(64)), false);
  assert.equal(Object.isFrozen(MAINNET_DEPLOYMENT_MANIFEST), true);
  for (const value of Object.values(MAINNET_DEPLOYMENT_MANIFEST)) {
    if (typeof value === "object") assert.equal(Object.isFrozen(value), true);
  }
});

test("payment binding encodes V2 arguments and decodes V2 registration, mandate, and payment results", () => {
  const client = new Client({ contractId: MAINNET.mandateRegistryId, rpcUrl: MAINNET.rpcUrl, networkPassphrase: MAINNET.networkPassphrase });
  const account = DEPLOYMENTS.mainnet.authorityAccount;
  const credential = Buffer.alloc(32, 1);
  const registeredId = Buffer.alloc(32, 2);
  const args = { user: account, agent: account, merchant: account, asset: MAINNET_USDC.contractId,
    max_amount: 600_000n, expiry: 1_800_000_000n, vc_hash: credential };
  const decodeArg = (value: xdr.ScVal) => { const native = scValToNative(value); return native instanceof Uint8Array ? Buffer.from(native) : native; };
  assert.deepEqual(client.spec.funcArgsToScVals("register_mandate", args).map(decodeArg), Object.values(args));
  assert.deepEqual(Buffer.from(client.spec.funcResToNative("register_mandate", xdr.ScVal.scvBytes(registeredId)).unwrap()), registeredId);
  const mandate = { ...args, spent: 200_000n, seq: 1, status: { tag: "Active" } };
  const mandateScVal = client.spec.nativeToScVal(mandate, xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "Mandate" })));
  const decoded = client.spec.funcResToNative("get_mandate", mandateScVal).unwrap();
  assert.deepEqual({ ...decoded, vc_hash: Buffer.from(decoded.vc_hash) }, mandate);
  assert.deepEqual(client.spec.funcArgsToScVals("execute_payment", { mandate_id: registeredId, amount: 200_000n, expected_seq: 1 }).map(decodeArg), [registeredId, 200_000n, 1]);
  assert.deepEqual(client.spec.funcArgsToScVals("validate_mandate", { mandate_id: registeredId, amount: 200_000n, expected_seq: 1, merchant: account, asset: MAINNET_USDC.contractId }).map(decodeArg), [registeredId, 200_000n, 1, account, MAINNET_USDC.contractId]);
  for (const method of ["execute_payment", "revoke_mandate", "validate_mandate"]) {
    assert.equal(client.spec.funcResToNative(method, xdr.ScVal.scvVoid()).unwrap(), null);
    assert.equal(client.spec.funcResToNative(method, xdr.ScVal.scvError(xdr.ScError.sceContract(6))).isErr(), true);
  }
});

test("official V2 binding preserves the exact published WASM spec and all 18 functions", () => {
  const client = new Client({ contractId: MAINNET.mandateRegistryId, rpcUrl: MAINNET.rpcUrl, networkPassphrase: MAINNET.networkPassphrase });
  const functions = client.spec.entries.filter((entry) => entry.switch().name === "scSpecEntryFunctionV0").map((entry) => entry.functionV0().name().toString());
  assert.deepEqual(functions.sort(), ["__constructor", "accept_admin", "derive_mandate_id", "execute_payment", "get_admin", "get_mandate", "get_pending_admin", "get_schema_version", "is_asset_allowed", "is_paused", "pause", "propose_admin", "register_mandate", "revoke_mandate", "set_asset_allowed", "unpause", "upgrade", "validate_mandate"].sort());
  const specBytes = Buffer.concat(client.spec.entries.map((entry) => entry.toXDR()));
  assert.equal(createHash("sha256").update(specBytes).digest("hex"), "4c5a232e101007aab8a9b3c717fec3720a65ceb454be2754f7deeb2f95737e6f");
  for (const method of functions.filter((name) => name !== "__constructor")) {
    assert.equal(typeof Reflect.get(client, method), "function", `${method} must be callable`);
    assert.equal(typeof Reflect.get(client.fromJSON, method), "function", `${method} must support signature handoff`);
  }
  for (const removed of ["set_admin", "schedule_upgrade", "execute_upgrade", "cancel_upgrade", "get_upgrade_delay", "get_pending_upgrade"]) {
    assert.equal(Reflect.get(client, removed), undefined, `${removed} must not be advertised on V2`);
  }
  const account = DEPLOYMENTS.mainnet.authorityAccount;
  const decode = (name: string, args: Record<string, unknown>) => client.spec.funcArgsToScVals(name, args).map(scValToNative);
  assert.deepEqual(decode("__constructor", { admin: account, initial_asset: MAINNET_USDC.contractId }), [account, MAINNET_USDC.contractId]);
  assert.deepEqual(decode("propose_admin", { new_admin: account }), [account]);
  assert.deepEqual(decode("set_asset_allowed", { asset: MAINNET_USDC.contractId, allowed: false }), [MAINNET_USDC.contractId, false]);
  assert.deepEqual(Buffer.from(decode("upgrade", { new_wasm_hash: Buffer.alloc(32, 7) })[0]), Buffer.alloc(32, 7));
  assert.equal(client.spec.funcResToNative("get_schema_version", xdr.ScVal.scvU32(2)).unwrap(), 2);
  assert.equal(client.spec.funcResToNative("get_pending_admin", xdr.ScVal.scvVoid()), null);
});

test("registry factory selects V2 for official Mainnet and legacy only for the explicitly selected older deployment", () => {
  const signer = { publicKey: DEPLOYMENTS.mainnet.authorityAccount, signTransaction: async () => { throw new Error("no signing in binding-selection test"); } };
  const mainnetClient = registryClient(MAINNET, signer);
  assert.equal(mainnetClient instanceof Client, true);
  assert.equal(typeof mainnetClient.upgrade, "function");
  assert.equal(registryClient(TESTNET, signer) instanceof LegacyClient, true);
  assert.equal(registryClient({ ...TESTNET, mandateRegistryId: MAINNET.mandateRegistryId }, signer) instanceof Client, true);
  assert.equal(registryClient({ ...MAINNET, mandateRegistryId: TESTNET.mandateRegistryId }, signer) instanceof Client, true);
});

test("published Mainnet helper requires the full verified manifest, not only its public address", () => {
  const net = publishedMainnetNetworkFromDeploymentManifest(publishedManifest());
  assert.equal(net.mandateRegistryId, DEPLOYMENTS.mainnet.mandateRegistryId);
  assert.equal(net.release.schemaVersion, 2);
  assert.equal(net.rpcUrl, "https://rpc.example.test");
  assert.equal(Object.isFrozen(net), true);
  for (const incomplete of [undefined, {}, DEPLOYMENTS.mainnet, { schema_version: 2, deployment: { registry_contract_id: DEPLOYMENTS.mainnet.mandateRegistryId } }]) {
    assert.throws(() => publishedMainnetNetworkFromDeploymentManifest(incomplete), /manifest/);
  }
  const unverified = publishedManifest(); unverified.verification.registry_usdc_asset_allowed = false;
  assert.throws(() => publishedMainnetNetworkFromDeploymentManifest(unverified), /must be true/);
});

test("published Mainnet helper rejects coherent but different registry, release bytes, source, or receipt", () => {
  const mutations: Array<(manifest: ReturnType<typeof publishedManifest>) => void> = [
    (value) => { value.deployment.registry_contract_id = StrKey.encodeContract(Buffer.alloc(32, 7)); },
    (value) => { value.source.commit = "a".repeat(40); },
    (value) => { value.source.version = "0.4.2"; },
    (value) => { value.artifacts.mandate_registry.sha256 = "b".repeat(64); value.deployment.registry_observed_wasm_hash = "b".repeat(64); },
    (value) => { value.artifacts.mandate_registry.interface_sha256 = "c".repeat(64); },
    (value) => { value.artifacts.mandate_registry.size_bytes++; },
    (value) => { value.deployment.ledger++; },
    (value) => { value.deployment.registry_transaction_hash = "d".repeat(64); },
    (value) => { value.deployment.wasm_upload_transaction_hash = "e".repeat(64); },
    (value) => {
      const otherAuthority = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
      value.public_configuration.deployment_source_account = otherAuthority;
      value.public_configuration.authority_2_of_3_account = otherAuthority;
      value.constructor_arguments.admin = otherAuthority;
    },
  ];
  for (const mutate of mutations) {
    const manifest = publishedManifest(); mutate(manifest);
    assert.throws(() => publishedMainnetNetworkFromDeploymentManifest(manifest), /published Mainnet/);
  }
});
