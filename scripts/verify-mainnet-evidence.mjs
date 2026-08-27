#!/usr/bin/env node
/**
 * Read-only Mainnet evidence verifier. This script cannot sign or submit a
 * transaction. It checks public HTTPS/RPC responses and decodes existing
 * finalized transaction events.
 */
import assert from "node:assert/strict";
import { Networks, StrKey, rpc, scValToNative } from "@stellar/stellar-sdk";

const REGISTRY = "CDBTG5ZKASFA7LOYUPBOTGKAVX5MJIM4U24BYGX7VX23IHYDAHLQPAGS";
const USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const AUTHORITY = "GCQNLXZSQUYVFXYTWPA6RF6KIRTGQNZYHR4JIILXE3LTMXZQAUW6PXN5";
const WALLET = "GBE3PH4ZYVYUXZWZL4YJP22H5J46U6VQVF6SYNJ3GGU3RHBN4M77VNBG";
const REFERENCE_USER = "GCFH7H3OTPKXLWZFDMPOGUVI4QRIYHX2G5EDRBGAXKTIARBYGDAW4IKN";
const AMOUNT = 100_000n;
const ASSET = `USDC:${ISSUER}`;

const PAYMENTS = [
  ["934239bcace9393e2ed0a39f114bf1d45c70e434ab4963a04ee17a132ea3bf8a", REFERENCE_USER, WALLET],
  ["dc4ba3ccfe04ee6daabf70e0253226daae4e73ee686db965fe00634b4bdac48b", REFERENCE_USER, WALLET],
  ["ba282c06511815319fb204d5e49bbed1ce2e062791032935dbb1031b1c03e90e", REFERENCE_USER, WALLET],
  ["64d8e859bbc8ef83030d96402c386f8116addf970ac62c14541bd921c48adfe1", WALLET, REFERENCE_USER],
];

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  assert.equal(response.ok, true, `${url} returned HTTP ${response.status}`);
  return response.json();
}

function decodedContractEvents(transaction) {
  const events = [];
  for (const group of transaction.events?.contractEventsXdr ?? []) {
    for (const event of group) {
      const body = event.body().v0();
      events.push({
        contract: StrKey.encodeContract(event.contractId()),
        topics: body.topics().map(scValToNative),
        data: scValToNative(body.data()),
      });
    }
  }
  return events;
}

async function main() {
  const [authority, wallet] = await Promise.all([
    json(`https://horizon.stellar.org/accounts/${AUTHORITY}`),
    json(`https://horizon.stellar.org/accounts/${WALLET}`),
  ]);
  assert.equal(Networks.PUBLIC, "Public Global Stellar Network ; September 2015");

  assert.deepEqual(authority.thresholds, {
    low_threshold: 2,
    med_threshold: 2,
    high_threshold: 2,
  });
  assert.equal(authority.signers.length, 3);
  assert.equal(new Set(authority.signers.map((signer) => signer.key)).size, 3);
  for (const signer of authority.signers) {
    assert.equal(signer.type, "ed25519_public_key");
    assert.equal(signer.weight, 1);
  }

  const trustline = wallet.balances.find((balance) =>
    balance.asset_code === "USDC" && balance.asset_issuer === ISSUER);
  assert.ok(trustline, "wallet is missing the official Circle USDC trustline");

  const server = new rpc.Server("https://mainnet.sorobanrpc.com");
  const observed = [];
  for (const [hash, from, merchant] of PAYMENTS) {
    const transaction = await server.getTransaction(hash);
    assert.equal(transaction.status, "SUCCESS", `${hash} is not finalized successfully`);
    const events = decodedContractEvents(transaction);
    const transfer = events.find((event) =>
      event.contract === USDC
      && event.topics[0] === "transfer"
      && event.topics[1] === from
      && event.topics[2] === merchant
      && event.topics[3] === ASSET
      && event.data === AMOUNT);
    assert.ok(transfer, `${hash} is missing the exact Circle USDC transfer`);
    const payment = events.find((event) =>
      event.contract === REGISTRY
      && event.topics[0] === "payment_executed"
      && event.topics[1] === merchant
      && event.data?.amount === AMOUNT);
    assert.ok(payment, `${hash} is missing the matching Registry payment event`);
    observed.push({ hash, ledger: transaction.ledger });
  }

  console.log("Ackrate Mainnet evidence gate passed");
  console.log("authority: 3 weight-1 signers, thresholds 2/2/2");
  console.log("wallet: official Circle USDC trustline present");
  for (const item of observed) {
    console.log(`payment: https://stellar.expert/explorer/public/tx/${item.hash} (ledger ${item.ledger})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
