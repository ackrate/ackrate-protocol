import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { StellarToml } from "@stellar/stellar-sdk";

const require = createRequire(import.meta.url);
// Resolve the parser from the SDK's dependency graph, including nested installs.
const sdkRequire = createRequire(require.resolve("@stellar/stellar-sdk"));
const toml = sdkRequire("smol-toml");
const qs = require("qs");
const issuerMetadata = 'VERSION="2.0.0"\nNETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"\n[[CURRENCIES]]\ncode="USDC"\ndisplay_decimals=7\n';

test("the SDK smol-toml parser reads normal issuer metadata", () => {
  const metadata = toml.parse(issuerMetadata);
  assert.equal(metadata.VERSION, "2.0.0");
  assert.equal(metadata.NETWORK_PASSPHRASE, "Public Global Stellar Network ; September 2015");
  assert.deepEqual(metadata.CURRENCIES, [{ code: "USDC", display_decimals: 7 }]);
});

test("the SDK issuer metadata resolver uses the compatible smol-toml path", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/.well-known/stellar.toml");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(issuerMetadata);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const metadata = await StellarToml.Resolver.resolve(`127.0.0.1:${server.address().port}`, { allowHttp: true, timeout: 0 });
    assert.equal(metadata.VERSION, "2.0.0");
    assert.equal(metadata.CURRENCIES[0].code, "USDC");
    assert.equal(metadata.CURRENCIES[0].display_decimals, 7);
    assert.deepEqual(metadata, toml.parse(issuerMetadata));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("smol-toml rejects excessive nesting and scalar-to-prototype paths without changing Object.prototype", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const input of [
    `a=${"[".repeat(3000)}1${"]".repeat(3000)}`,
    `a=${"{a=".repeat(3000)}1${"}".repeat(3000)}`,
    '[a.b]\ny=1\n[a.b.y.__proto__.__proto__]\nackrate_toml_regression_marker="yes"\n',
  ]) {
    assert.throws(() => toml.parse(input), (error) =>
      error instanceof toml.TomlError && !(error instanceof RangeError));
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
    assert.equal(Object.getPrototypeOf(Object.prototype), null);
  }
});

test("smol-toml keeps prototype-named tables as document data", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  const metadata = toml.parse('[__proto__]\nackrate_toml_regression_marker="yes"\n[constructor.prototype]\nackrate_toml_regression_marker="yes"\n');
  assert.ok(Object.hasOwn(metadata, "__proto__"));
  assert.ok(Object.hasOwn(metadata, "constructor"));
  assert.equal(metadata.__proto__.ackrate_toml_regression_marker, "yes");
  assert.equal(metadata.constructor.prototype.ackrate_toml_regression_marker, "yes");
  assert.equal(Object.getPrototypeOf(metadata), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
  assert.equal(Object.getPrototypeOf(Object.prototype), null);
});

test("qs enforces bracket-comma limits and handles attacker-controlled isBuffer fields", () => {
  assert.throws(() => qs.parse("a[]=1,2,3,4", { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }), RangeError);
  const parsed = qs.parse("x%5Bconstructor%5D%5BisBuffer%5D=y", { plainObjects: true });
  assert.doesNotThrow(() => qs.stringify(parsed));
  assert.deepEqual(qs.parse("service=search&query=What%20is%20Stellar"), { service: "search", query: "What is Stellar" });
});
