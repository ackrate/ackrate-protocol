import assert from "node:assert/strict";
import test from "node:test";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";

import { networks } from "./client.js";
import { TESTNET } from "./config.js";
import { DEPLOYMENTS, publishedMainnetNetworkFromDeploymentManifest } from "./deployments.js";
import { MAINNET_USDC } from "./release-manifest.js";

const PERMANENT_TESTNET_REGISTRY =
  "CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM";

test("all published testnet defaults use the permanent upgradable contract", () => {
  assert.equal(DEPLOYMENTS.testnet.mandateRegistryId, PERMANENT_TESTNET_REGISTRY);
  assert.equal(TESTNET.mandateRegistryId, PERMANENT_TESTNET_REGISTRY);
  assert.equal(networks.testnet.contractId, PERMANENT_TESTNET_REGISTRY);
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

test("published Mainnet identity is discoverable without changing testnet signing defaults", () => {
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
