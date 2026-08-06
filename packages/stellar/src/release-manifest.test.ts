import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import {
  MAINNET_USDC,
  mainnetNetworkFromDeploymentManifest,
} from "./release-manifest.js";

const contract = (fill: number) => StrKey.encodeContract(Buffer.alloc(32, fill));
const hash = (fill: string) => fill.repeat(64);

function validManifest() {
  const authority = Keypair.random().publicKey();
  const pauser = Keypair.random().publicKey();
  const source = Keypair.random().publicKey();
  return {
    schema_version: 1,
    network: {
      name: "mainnet",
      passphrase: Networks.PUBLIC,
      rpc_url: "https://rpc.example.test",
    },
    source: {
      repository: "https://github.com/reapp-protocol/reapp-protocol-contracts",
      branch: "t3",
      commit: "1".repeat(40),
      dirty: false,
      stellar_cli_version: "26.1.0",
    },
    artifacts: {
      timelock_controller: { path: "timelock.wasm", sha256: hash("a"), size_bytes: 1 },
      mandate_registry: { path: "registry.wasm", sha256: hash("b"), size_bytes: 1 },
    },
    public_configuration: {
      deployment_source_account: source,
      authority_2_of_3_account: authority,
      emergency_pauser: pauser,
      timelock_min_delay_ledgers: 120,
      usdc_asset_code: MAINNET_USDC.code,
      usdc_issuer: MAINNET_USDC.issuer,
      usdc_sac: contract(3),
      usdc_derivation_evidence: "independent derivation record",
      usdc_independent_verifier: "Verifier A",
    },
    constructor_arguments: {},
    deployment: {
      authorized_by: "approved release record",
      authorized_at: "2026-08-01T00:00:00.000Z",
      deployed_at: "2026-08-01T01:00:00.000Z",
      ledger: 123,
      timelock_transaction_hash: hash("c"),
      timelock_contract_id: contract(1),
      timelock_observed_wasm_hash: hash("a"),
      registry_transaction_hash: hash("d"),
      registry_contract_id: contract(2),
      registry_observed_wasm_hash: hash("b"),
    },
    verification: {
      artifact_hashes_match: true,
      constructor_arguments_match: true,
      timelock_self_administered: true,
      authority_is_proposer_and_canceller: true,
      executor_is_permissionless_after_delay: true,
      registry_admin_is_timelock: true,
      registry_asset_policy_is_timelock: true,
      registry_upgrader_is_timelock: true,
      registry_unpauser_is_2_of_3: true,
      registry_pauser_is_emergency_key: true,
      registry_initially_unpaused: true,
      registry_usdc_asset_allowed: true,
      independent_read_only_verifier: "Verifier B",
      verified_at: "2026-08-01T02:00:00.000Z",
    },
  };
}

test("creates mainnet SDK configuration only from a complete verified manifest", () => {
  const manifest = validManifest();
  const config = mainnetNetworkFromDeploymentManifest(manifest);
  assert.equal(config.networkPassphrase, Networks.PUBLIC);
  assert.equal(config.mandateRegistryId, manifest.deployment.registry_contract_id);
  assert.equal(config.settlementAsset.contractId, manifest.public_configuration.usdc_sac);
  assert.equal(config.release.sourceCommit, manifest.source.commit);
});

test("rejects a manifest whose mainnet verification is incomplete", () => {
  const manifest = validManifest();
  manifest.verification.registry_usdc_asset_allowed = false;
  assert.throws(
    () => mainnetNetworkFromDeploymentManifest(manifest),
    /registry_usdc_asset_allowed must be true/,
  );
});

test("rejects a conflicting USDC identity or observed artifact hash", () => {
  const wrongIssuer = validManifest();
  (wrongIssuer.public_configuration as { usdc_issuer: string }).usdc_issuer = Keypair.random().publicKey();
  assert.throws(() => mainnetNetworkFromDeploymentManifest(wrongIssuer), /USDC issuer/);

  const wrongHash = validManifest();
  wrongHash.deployment.registry_observed_wasm_hash = hash("e");
  assert.throws(() => mainnetNetworkFromDeploymentManifest(wrongHash), /registry artifact/);
});
