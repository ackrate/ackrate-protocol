import { Asset, Networks, rpc } from "@stellar/stellar-sdk";
import { registryClient, token, type ReleaseNetworkConfig, type StellarSigner } from "@ackrate/stellar";
import { toStroops } from "@ackrate/core";
import { networkConfig, type MainnetConfig } from "./config.js";
import { stellarCliSigner } from "./stellar-cli-signer.js";
import { requireMainnetFunding } from "./mainnet-funding.js";

export interface MainnetProjectRuntime {
  net: ReleaseNetworkConfig;
  userSigner: StellarSigner;
  agentSigner: StellarSigner;
  merchant: string;
  chainDecimals: number;
  userUsdc: bigint;
  userXlm: bigint;
  agentXlm: bigint;
}

/** Both ends of a SAC transfer must be authorized, even when their balances exist. */
export async function requireMainnetUsdcAuthorization(
  net: ReleaseNetworkConfig,
  user: string,
  merchant: string,
  readAuthorization: typeof token.authorized = token.authorized,
): Promise<void> {
  const [userAuthorized, merchantAuthorized] = await Promise.all([
    readAuthorization(net, net.settlementAsset.contractId, user),
    readAuthorization(net, net.settlementAsset.contractId, merchant),
  ]);
  if (userAuthorized !== true) {
    throw new Error("mainnet user is not authorized to send Circle USDC; resolve its trustline authorization before registering a mandate");
  }
  if (merchantAuthorized !== true) {
    throw new Error("mainnet merchant is not authorized to receive Circle USDC; resolve its trustline authorization before registering a mandate");
  }
}

export async function mainnetProjectPreflight(
  config: MainnetConfig,
  requiredUsdc: string = config.budget,
): Promise<MainnetProjectRuntime> {
  const net = networkConfig(config) as ReleaseNetworkConfig;
  const [userSigner, agentSigner] = await Promise.all([
    stellarCliSigner(config.userSigner, net),
    stellarCliSigner(config.agentSigner, net),
  ]);
  if (new Set([userSigner.publicKey, agentSigner.publicKey, config.merchant]).size !== 3) {
    throw new Error("mainnet user, agent, and merchant accounts must be distinct");
  }
  const server = new rpc.Server(net.rpcUrl);
  const identity = await server.getNetwork();
  if (identity.passphrase !== Networks.PUBLIC || net.networkPassphrase !== Networks.PUBLIC) {
    throw new Error("mainnet RPC identity does not match the public Stellar network");
  }
  await requireMainnetUsdcAuthorization(net, userSigner.publicKey, config.merchant);
  const chainDecimals = await token.decimals(net, net.settlementAsset.contractId, userSigner.publicKey);
  if (chainDecimals !== net.settlementAsset.decimals) {
    throw new Error(`USDC decimals conflict: manifest=${net.settlementAsset.decimals}, chain=${chainDecimals}`);
  }
  const { userUsdc, userXlm, agentXlm } = await requireMainnetFunding(server,
    new Asset(net.settlementAsset.code, net.settlementAsset.issuer),
    userSigner.publicKey, agentSigner.publicKey, config.merchant, toStroops(requiredUsdc, chainDecimals));
  if ((await registryClient(net, agentSigner).is_paused()).result) {
    throw new Error("mainnet MandateRegistry is paused");
  }
  return Object.freeze({
    net,
    userSigner,
    agentSigner,
    merchant: config.merchant,
    chainDecimals,
    userUsdc,
    userXlm,
    agentXlm,
  });
}
