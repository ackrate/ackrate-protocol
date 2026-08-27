import { Networks, rpc } from "@stellar/stellar-sdk";
import { registryClient, token, type ReleaseNetworkConfig, type StellarSigner } from "@ackrate/stellar";
import { toStroops } from "@ackrate/core";
import { networkConfig, type MainnetConfig } from "./config.js";
import { stellarCliSigner } from "./stellar-cli-signer.js";

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
  await Promise.all([
    server.getAccount(userSigner.publicKey),
    server.getAccount(agentSigner.publicKey),
    server.getAccount(config.merchant),
  ]);
  const [chainDecimals, userUsdc, userXlm, agentXlm] = await Promise.all([
    token.decimals(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.settlementAsset.contractId, userSigner.publicKey),
    token.balance(net, net.nativeSac, userSigner.publicKey),
    token.balance(net, net.nativeSac, agentSigner.publicKey),
  ]);
  if (chainDecimals !== net.settlementAsset.decimals) {
    throw new Error(`USDC decimals conflict: manifest=${net.settlementAsset.decimals}, chain=${chainDecimals}`);
  }
  if (userUsdc < toStroops(requiredUsdc, chainDecimals)) {
    throw new Error("mainnet user USDC balance is below the required amount");
  }
  const feeReserve = toStroops("0.50", 7);
  if (userXlm < feeReserve || agentXlm < feeReserve) {
    throw new Error("mainnet user and agent must each retain at least 0.50 XLM for fees and reserve headroom");
  }
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
