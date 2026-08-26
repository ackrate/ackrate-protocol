import { mainnetNetworkFromDeploymentManifest } from "./release-manifest.js";

export const MAINNET_RELEASE_MANIFEST = Object.freeze({
  schema_version: 1,
  network: {
    name: "mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    rpc_url: "https://mainnet.sorobanrpc.com",
  },
  source: {
    repository: "https://github.com/ackrate/ackrate-protocol-contracts",
    commit: "51b93159d5a4e29d9e48fe99f489d70271703494",
    dirty: false,
  },
  artifacts: {
    timelock_controller: {
      sha256: "99a32170feaf3521338adfadb25d1a2ea573e6d29ec5de97e9d9cc3e4a99da97",
      size_bytes: 28_429,
    },
    mandate_registry: {
      sha256: "3656430ac7cf5e7cf1c26948b46314c37866c2d7e928ea89d7d1f89b8aa0ef3c",
      size_bytes: 27_059,
    },
  },
  public_configuration: {
    deployment_source_account: "GADKNO6PXPSHPB5SEL5T7VZSBNIV7Z5WWHX5RGSZYNEUL3RKBEL2KVYK",
    authority_2_of_3_account: "GCQNLXZSQUYVFXYTWPA6RF6KIRTGQNZYHR4JIILXE3LTMXZQAUW6PXN5",
    emergency_pauser: "GCL6IG2J5QRO4B2XBXJ6QUGKEAMOCOS2HQIRMJWBPVEBZRDM5EZPR3TY",
    timelock_min_delay_ledgers: 17_280,
    usdc_asset_code: "USDC",
    usdc_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    usdc_sac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    usdc_derivation_evidence: "Circle issuer plus independent Stellar CLI and SDK derivation",
    usdc_independent_verifier: "Stellar CLI 26.1.0 and @stellar/stellar-sdk 14.5.0",
  },
  deployment: {
    authorized_by: "Ackrate deployment owner through interactive canary approval",
    authorized_at: "2026-08-26T12:19:46.000Z",
    deployed_at: "2026-08-26T12:20:20.000Z",
    ledger: 64_132_889,
    timelock_transaction_hash: "ecc8becb4473454d99811c90dd7bcf81175833717063f69c30438f847f065213",
    timelock_contract_id: "CD3KRQRNCW52CZHKG2GPQAEOU6UCL426YFNHYUZ7IWUUKAOTKUQX6UUX",
    timelock_observed_wasm_hash: "99a32170feaf3521338adfadb25d1a2ea573e6d29ec5de97e9d9cc3e4a99da97",
    registry_transaction_hash: "0d7e689188f58d9a68b0ef0c08f0fed3aaac5033e618240f8f7a7bd28e073c05",
    registry_contract_id: "CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS",
    registry_observed_wasm_hash: "3656430ac7cf5e7cf1c26948b46314c37866c2d7e928ea89d7d1f89b8aa0ef3c",
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
    independent_read_only_verifier: "Stellar CLI 26.1.0, Horizon, and StellarExpert public API",
    verified_at: "2026-08-26T13:49:20.000Z",
  },
} as const);

export const MAINNET = mainnetNetworkFromDeploymentManifest(MAINNET_RELEASE_MANIFEST);
