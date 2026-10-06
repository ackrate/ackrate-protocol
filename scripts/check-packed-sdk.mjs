import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = realpathSync(path.resolve(process.argv[2]));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(manifest.overrides, undefined, "consumer overrides must not protect the bundle");
const names = ["stellar", "core", "ap2", "express-middleware", "cli"];
const copies = [];
function packageFile(require, name) {
  let directory = path.dirname(require.resolve(name));
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, "package.json");
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) return file;
    directory = path.dirname(directory);
  }
  throw new Error(`cannot locate ${name} package manifest`);
}
for (const name of names) {
  const file = path.join(root, "node_modules", "@ackrate", name, "package.json");
  if (!existsSync(file)) continue;
  const require = createRequire(file);
  const sdkFile = packageFile(require, "@stellar/stellar-sdk");
  const sdkManifest = JSON.parse(readFileSync(sdkFile, "utf8"));
  const sdk = await import(pathToFileURL(path.join(path.dirname(sdkFile), sdkManifest.exports["."].import)).href);
  assert.ok(sdkFile.startsWith(path.dirname(file) + path.sep), `${name} must use its bundled SDK`);
  const sdkRequire = createRequire(sdkFile);
  const axios = JSON.parse(readFileSync(packageFile(sdkRequire, "axios"), "utf8"));
  assert.equal(sdkManifest.version, "16.3.0");
  assert.equal(axios.version, "1.20.0");
  copies.push({ name, sdk });
  if (name === "express-middleware") {
    const x402Require = createRequire(require.resolve("@x402/stellar"));
    const upstreamSdk = packageFile(x402Require, "@stellar/stellar-sdk");
    assert.ok(upstreamSdk.startsWith(path.dirname(file) + path.sep));
    assert.equal(JSON.parse(readFileSync(upstreamSdk, "utf8")).version, "16.3.0");
    const upstreamAxios = packageFile(createRequire(upstreamSdk), "axios");
    assert.equal(JSON.parse(readFileSync(upstreamAxios, "utf8")).version, "1.20.0");
  }
}
assert.ok(copies.length > 0);
const canonical = copies[0].sdk;
const sdkIdentities = new Set(copies.map(({ sdk }) => sdk.Transaction));
const stellarPath = path.join(root, "node_modules/@ackrate/stellar/dist/index.js");
const stellar = existsSync(stellarPath) ? await import(pathToFileURL(stellarPath).href) : undefined;
if (stellar) assert.equal(stellar.Transaction, copies.find(({ name }) => name === "stellar").sdk.Transaction);
for (const { sdk } of copies) {
  // Bundled copies have distinct class identities. The public boundaries must
  // accept foreign keys/XDR and exchange serialized transaction envelopes.
  const keypair = sdk.Keypair.random();
  const value = sdk.nativeToScVal(7n, { type: "i128" });
  const operation = new canonical.Contract("CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR").call("probe", value);
  assert.equal(canonical.scValToNative(canonical.xdr.ScVal.fromXDR(value.toXDR())), 7n);
  const tx = new canonical.TransactionBuilder(new canonical.Account(keypair.publicKey(), "0"), {
    fee: "100", networkPassphrase: canonical.Networks.TESTNET,
  }).addOperation(operation).setTimeout(60).build();
  const parsed = sdk.TransactionBuilder.fromXDR(tx.toXDR(), sdk.Networks.TESTNET);
  assert.ok(parsed instanceof sdk.Transaction);
  assert.equal(parsed instanceof canonical.Transaction, sdk.Transaction === canonical.Transaction);
  assert.deepEqual(parsed.hash(), tx.hash());
  parsed.sign(keypair);
  const signed = canonical.TransactionBuilder.fromXDR(parsed.toXDR(), canonical.Networks.TESTNET);
  assert.ok(canonical.Keypair.fromPublicKey(keypair.publicKey()).verify(signed.hash(), signed.signatures[0].signature()));
  if (stellar) {
    const signer = stellar.keypairSigner(keypair, canonical.Networks.TESTNET);
    assert.equal(stellar.isStellarSigner(signer), true);
    const { signedTxXdr } = await signer.signTransaction(tx.toXDR(), { networkPassphrase: canonical.Networks.TESTNET });
    const walletSigned = sdk.TransactionBuilder.fromXDR(signedTxXdr, sdk.Networks.TESTNET);
    assert.ok(keypair.verify(walletSigned.hash(), walletSigned.signatures[0].signature()));
    const payload = Buffer.from("packed SDK signer interoperability");
    assert.ok(keypair.verify(payload, Buffer.from(await signer.signPayload(payload))));
    const authPreimage = sdk.xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new sdk.xdr.HashIdPreimageSorobanAuthorization({
        networkId: sdk.hash(Buffer.from(sdk.Networks.TESTNET)), nonce: sdk.xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        invocation: new sdk.xdr.SorobanAuthorizedInvocation({
          function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new sdk.xdr.InvokeContractArgs({
              contractAddress: new sdk.Address("CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR").toScAddress(),
              functionName: "probe", args: [value],
            })), subInvocations: [],
        }),
      }));
    const authBytes = authPreimage.toXDR();
    const { signedAuthEntry } = await signer.signAuthEntry(authBytes.toString("base64"));
    assert.ok(keypair.verify(sdk.hash(authBytes), Buffer.from(signedAuthEntry, "base64")));
  }
}
if (stellar && existsSync(path.join(root, "node_modules/@ackrate/core/dist/index.js"))) {
  const { ackrate } = await import(pathToFileURL(path.join(root, "node_modules/@ackrate/core/dist/index.js")).href);
  const foreign = copies.find(({ name }) => name === "core").sdk;
  const signer = foreign.Keypair.random();
  const mandate = ackrate.createIntentMandate({ user: signer.publicKey(), agent: signer.publicKey(),
    merchant: foreign.Keypair.random().publicKey(), asset: ackrate.testnet.nativeSac,
    maxAmount: "1.00", expiry: Math.floor(Date.now() / 1000) + 3600 });
  const client = ackrate.agent({ mandate, signer });
  await assert.rejects(() => client.pay("1.00"), /onPrepared durable settlement journal/);
  // Exercise the actual generated registry binding and signer normalization,
  // without contacting a chain. Decode its arguments with each foreign SDK.
  const original = stellar.contract.AssembledTransaction.build;
  const calls = [];
  stellar.contract.AssembledTransaction.build = async (options) => {
    calls.push(options.method);
    assert.equal(typeof options.signTransaction, "function");
    const decoded = foreign.scValToNative(foreign.xdr.ScVal.fromXDR(options.args[6].toXDR()));
    assert.deepEqual(Buffer.from(decoded), Buffer.from(mandate.idBuffer));
    return { result: { unwrap: () => Buffer.alloc(32, 42) }, signAndSend: async () => ({
      result: { unwrap: () => Buffer.alloc(32, 42) }, sendTransactionResponse: { hash: "f".repeat(64) },
    }) };
  };
  try { assert.equal(await ackrate.registerMandate(mandate, { signer }), "f".repeat(64)); }
  finally { stellar.contract.AssembledTransaction.build = original; }
  assert.deepEqual(calls, ["register_mandate"]);
}
console.log(JSON.stringify({ packages: copies.map(({ name }) => name), stellarVersion: "16.3.0", axiosVersion: "1.20.0",
  transactionClassIdentities: sdkIdentities.size, interoperability: "passed", consumerOverrides: false,
  consumerLockSha256: createHash("sha256").update(readFileSync(path.join(root, "package-lock.json"))).digest("hex") }));
