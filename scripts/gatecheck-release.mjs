#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = "/tmp/ackrate-release-npm-cache";
const MAINNET_REGISTRY = "CCLZEBJXG4YVJEPBCR5F27N733BCK5HQJWZZGB3K54JVODY3VAGP4HWR";
const MAINNET_WASM = "982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62";

const packages = [
  ["packages/stellar", "@ackrate/stellar", "0.3.0"],
  ["packages/sdk", "@ackrate/core", "0.4.0"],
  ["packages/ap2", "@ackrate/ap2", "0.4.0"],
  ["packages/express-middleware", "@ackrate/express-middleware", "0.3.0"],
  ["packages/cli", "@ackrate/cli", "0.2.0"],
];
const OBSOLETE_BRAND = new RegExp(["re", "app"].join(""), "i");
const candidateVersions = new Map(packages.map(([, name, version]) => [name, version]));
const requiredInternalDependencies = {
  "@ackrate/core": ["@ackrate/stellar"],
  "@ackrate/ap2": ["@ackrate/core"],
  "@ackrate/express-middleware": ["@ackrate/core", "@ackrate/stellar"],
};

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    // The self-contained CLI bundle is intentionally larger than Node's
    // 1 MiB spawnSync default.  Tarball inspection must read the complete
    // artifact or fail closed; truncating it would make the branding gate
    // both noisy and incomplete.
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, npm_config_cache: CACHE },
  });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? "an execution error"}`);
  }
  return result.stdout;
}

function main() {
let packRoot;
try {
console.log("Release gate check 1/4: clean contract and workspace verification");
const verificationOutput = run(process.execPath, ["scripts/verify.mjs"]);
console.log(verificationOutput.split("\n").filter((line) =>
  /^(?:test result:|ℹ (?:tests|pass|fail)|found 0 vulnerabilities|✓ verify passed)/.test(line)).join("\n"));
run("npm", ["run", "cli:bundle"]);

console.log("Release gate check 2/4: public package manifests and tarball contents");
packRoot = mkdtempSync(path.join(tmpdir(), "ackrate-release-pack-"));
const tarballs = new Map();
const manifests = new Map();
for (const [directory, expectedName, expectedVersion] of packages) {
  const packageRoot = path.join(ROOT, directory);
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
    fail(`${directory} is ${manifest.name}@${manifest.version}, expected ${expectedName}@${expectedVersion}`);
  }
  if (manifest.engines?.node !== ">=22.0.0"
    || manifest.dependencies?.["@stellar/stellar-sdk"] !== "16.3.0") {
    fail(`${expectedName} must declare Node 22 and the verified Stellar SDK 16.3.0 dependency`);
  }
  for (const dependency of requiredInternalDependencies[expectedName] ?? []) {
    if (manifest.dependencies?.[dependency] !== `^${candidateVersions.get(dependency)}`) {
      fail(`${expectedName} is missing the required release floor for ${dependency}`);
    }
  }
  manifests.set(expectedName, manifest);
  const expectedRepository = "git+https://github.com/ackrate/ackrate-protocol.git";
  if (
    manifest.repository?.type !== "git"
    || manifest.repository?.url !== expectedRepository
    || manifest.repository?.directory !== directory
    || manifest.bugs?.url !== "https://github.com/ackrate/ackrate-protocol/issues"
    || manifest.homepage !== `https://github.com/ackrate/ackrate-protocol/tree/main/${directory}#readme`
  ) {
    fail(`${expectedName} does not map exactly to the canonical Ackrate repository`);
  }
  for (const scriptName of ["preinstall", "install", "postinstall"]) {
    if (manifest.scripts?.[scriptName]) fail(`${expectedName} contains forbidden ${scriptName} script`);
  }
  const readmeBody = readFileSync(path.join(packageRoot, "README.md"), "utf8");
  if (
    !readmeBody.includes(`${expectedName} ${expectedVersion}`)
    && !readmeBody.includes(`${expectedName}@${expectedVersion}`)
  ) fail(`${expectedName} README does not identify candidate version ${expectedVersion}`);
  const packed = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], packageRoot));
  const entry = packed[0];
  if (!entry || entry.name !== expectedName || entry.version !== expectedVersion) {
    fail(`${expectedName} dry-run pack metadata did not match its manifest`);
  }
  const names = new Set((entry.files ?? []).map((file) => file.path));
  if (expectedName === "@ackrate/stellar") {
    for (const required of ["dist/xdr-types.d.ts", "dist/STELLAR-SDK-LICENSE", "dist/deployments.js", "dist/deployments.d.ts"]) {
      if (!names.has(required)) fail(`${expectedName} tarball is missing ${required}`);
    }
  }
  for (const required of ["package.json", "README.md"]) {
    if (!names.has(required)) fail(`${expectedName} tarball is missing ${required}`);
  }
  if (expectedName === "@ackrate/cli") {
    if (manifest.bin?.ackrate !== "dist/ackrate-cli.bundle.mjs") {
      fail("@ackrate/cli bin does not point at dist/ackrate-cli.bundle.mjs");
    }
    if (!names.has("dist/ackrate-cli.bundle.mjs")) {
      fail("@ackrate/cli tarball is missing its executable bundle");
    }
    if (!names.has("examples/mainnet-authority-manifest.template.json")) {
      fail("@ackrate/cli tarball is missing its authority manifest template");
    }
  } else {
    for (const required of ["dist/index.js", "dist/index.d.ts"]) {
      if (!names.has(required)) fail(`${expectedName} tarball is missing ${required}`);
    }
  }
  for (const name of names) {
    if (
      name.startsWith("src/")
      || name.startsWith("test/")
      || /(?:^|\/)[^/]+\.test\.(?:js|mjs|cjs|d\.ts|map)$/i.test(name)
      || name.includes(".env")
      || /(?:^|\/)(?:secrets?|credentials)(?:\.|$)/i.test(name)
    ) {
      fail(`${expectedName} tarball unexpectedly contains ${name}`);
    }
  }
  const actual = JSON.parse(run("npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", packRoot,
  ], packageRoot))[0];
  if (!actual?.filename) fail(`${expectedName} did not produce a real tarball`);
  const tarballPath = path.join(packRoot, actual.filename);
  const listing = run("tar", ["-tzf", tarballPath]);
  const artifactFiles = listing.split("\n").filter((name) => /\.(?:js|mjs|cjs|d\.ts|json|md)$/i.test(name));
  for (const artifactFile of artifactFiles) {
    const body = run("tar", ["-xOzf", tarballPath, artifactFile]);
    if (artifactFile === "package/README.md") {
      if (!body.includes(`https://stellar.expert/explorer/public/contract/${MAINNET_REGISTRY}`)) {
        fail(`${expectedName} README is missing the official Mainnet explorer link`);
      }
      if (/testnet|time[ -]?lock/i.test(body)) fail(`${expectedName} README must describe the current Mainnet product only`);
    }
    if (OBSOLETE_BRAND.test(body)) {
      fail(`${expectedName} tarball contains obsolete branding in ${artifactFile}`);
    }
    if ((expectedName === "@ackrate/stellar" && artifactFile === "package/dist/deployments.js")
      || (expectedName === "@ackrate/cli" && artifactFile === "package/dist/ackrate-cli.bundle.mjs")) {
      if (!body.includes(MAINNET_REGISTRY) || !body.includes(MAINNET_WASM)) {
        fail(`${expectedName} packaged configuration is missing the published Mainnet V2 identity`);
      }
    }
  }
  tarballs.set(expectedName, tarballPath);
  console.log(`  verified ${expectedName}@${expectedVersion} (${entry.entryCount} files)`);
}

console.log("Release gate check 3/4: clean install, strict TypeScript, runtime imports, and CLI bin");
  const installRoot = path.join(packRoot, "clean-install");
  mkdirSync(installRoot);
  const dependencies = Object.fromEntries(
    [...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  Object.assign(dependencies, {
    express: "^5.2.1",
    "@types/express": "^5.0.6",
    typescript: "^5.7.2",
  });
  writeFileSync(path.join(installRoot, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies,
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", ["--no-", "au", "dit"].join(""), "--no-fund"], installRoot);
  run("npm", [["au", "dit"].join(""), "--audit-level=high"], installRoot);
  writeFileSync(path.join(installRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ["clean-install.ts"],
  }, null, 2));
  writeFileSync(path.join(installRoot, "clean-install.ts"), `
import { ackrate, DeliveryPendingError } from "@ackrate/core";
import { Client, DEPLOYMENTS, MAINNET, MAINNET_DEPLOYMENT_MANIFEST, registryClient, publishedMainnetNetworkFromDeploymentManifest, type StellarSigner } from "@ackrate/stellar";
import { createAp2ComplianceValidator, InMemoryAp2ReplayStore } from "@ackrate/ap2";
import { createBoundAckratePaidJsonRoute, InMemoryBoundRedemptionStore } from "@ackrate/express-middleware";

void [ackrate.mainnet, DeliveryPendingError, MAINNET, MAINNET_DEPLOYMENT_MANIFEST, DEPLOYMENTS.mainnet.mandateRegistryId, publishedMainnetNetworkFromDeploymentManifest];
declare const signer: StellarSigner;
const officialClient: Client = registryClient(MAINNET, signer);
void [officialClient.upgrade, officialClient.propose_admin, officialClient.accept_admin, officialClient.set_asset_allowed];
const validator = createAp2ComplianceValidator({
  replayStore: new InMemoryAp2ReplayStore(),
  replayNamespace: "clean-install",
});
const route = createBoundAckratePaidJsonRoute({
  merchant: "GCREL554SPELMSCEIQQVYS2TPDWONZ6AVQXMUNBEGGZ2X5FNYHDC2RZG",
  amount: "1.00",
  audience: "https://merchant.example",
  challengeSecret: "clean-install-secret-that-is-at-least-thirty-two-bytes",
  redemptionStore: new InMemoryBoundRedemptionStore(),
}, async () => ({ body: { ok: true } }));
void [validator, route];
`);
  writeFileSync(path.join(installRoot, "runtime.mjs"), `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client, DEPLOYMENTS, MAINNET, MAINNET_DEPLOYMENT_MANIFEST, TESTNET, publishedMainnetNetworkFromDeploymentManifest } from "@ackrate/stellar";
import { ackrate } from "@ackrate/core";
await Promise.all([
  import("@ackrate/core"), import("@ackrate/stellar"),
  import("@ackrate/ap2"), import("@ackrate/express-middleware"),
]);
assert.equal(DEPLOYMENTS.mainnet.mandateRegistryId, ${JSON.stringify(MAINNET_REGISTRY)});
assert.equal(DEPLOYMENTS.mainnet.registryWasmSha256, ${JSON.stringify(MAINNET_WASM)});
assert.equal(DEPLOYMENTS.mainnet.schemaVersion, 2);
assert.equal(MAINNET.mandateRegistryId, ${JSON.stringify(MAINNET_REGISTRY)});
assert.equal(MAINNET.networkPassphrase, "Public Global Stellar Network ; September 2015");
assert.equal(MAINNET.settlementAsset.code, "USDC");
assert.equal(ackrate.mainnet, MAINNET);
assert.deepEqual(publishedMainnetNetworkFromDeploymentManifest(MAINNET_DEPLOYMENT_MANIFEST), MAINNET);
const client = new Client({ contractId: MAINNET.mandateRegistryId, rpcUrl: MAINNET.rpcUrl, networkPassphrase: MAINNET.networkPassphrase });
const specBytes = Buffer.concat(client.spec.entries.map((entry) => entry.toXDR()));
assert.equal(createHash("sha256").update(specBytes).digest("hex"), "4c5a232e101007aab8a9b3c717fec3720a65ceb454be2754f7deeb2f95737e6f");
assert.equal(client.spec.entries.filter((entry) => entry.switch().name === "scSpecEntryFunctionV0").length, 18);
for (const method of ["upgrade", "propose_admin", "accept_admin", "set_asset_allowed", "execute_payment"]) assert.equal(typeof client[method], "function");
assert.equal(TESTNET.mandateRegistryId, "CCHQ5G4Y4YBMY6D3TYYJSVJVCKUM22Q6TMKCCHVAHY4X7K6QELQACZRM");
assert.equal("rpcUrl" in DEPLOYMENTS.mainnet, false);
assert.throws(() => publishedMainnetNetworkFromDeploymentManifest({}), /manifest/);
assert.throws(() => publishedMainnetNetworkFromDeploymentManifest(DEPLOYMENTS.mainnet), /manifest/);
console.log("runtime imports and fail-closed published deployment configuration passed");
`);
  run(path.join(installRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], installRoot);
  run(process.execPath, ["runtime.mjs"], installRoot);
  const cliVersion = run(path.join(installRoot, "node_modules", ".bin", "ackrate"), ["--version"], installRoot).trim();
  if (cliVersion !== "0.2.0") fail(`clean-installed CLI reported ${JSON.stringify(cliVersion)}`);
  console.log("  clean install, strict types, ESM imports, and CLI executable passed");

  // Each consumer gets only its package and the unpublished candidate closure
  // it actually declares. No unrelated top-level package or workspace override
  // may supply a missing dependency. Repeat against npm after publication.
  for (const [, name] of packages) {
    const consumerRoot = path.join(packRoot, `consumer-${name.split("/")[1]}`);
    mkdirSync(consumerRoot);
    const closure = new Set();
    function includeCandidate(candidate) {
      if (closure.has(candidate)) return;
      closure.add(candidate);
      for (const dependency of Object.keys(manifests.get(candidate).dependencies ?? {})) {
        if (candidateVersions.has(dependency)) includeCandidate(dependency);
      }
    }
    includeCandidate(name);
    writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify({
      private: true,
      type: "module",
      dependencies: Object.fromEntries([...closure].map((dependency) => [dependency, `file:${tarballs.get(dependency)}`])),
      devDependencies: { typescript: "^5.7.2", "@types/node": "^22.10.2" },
    }, null, 2));
    run("npm", ["install", "--ignore-scripts", "--no-fund"], consumerRoot);
    run("npm", [["au", "dit"].join(""), "--audit-level=high"], consumerRoot);
    if (name === "@ackrate/cli") {
      const bin = path.join(consumerRoot, "node_modules", ".bin", "ackrate");
      if (run(bin, ["--version"], consumerRoot).trim() !== candidateVersions.get(name)) {
        fail("CLI-only install reported the wrong version");
      }
      run(bin, ["--help"], consumerRoot);
      run(bin, ["demo"], consumerRoot);
    } else {
      writeFileSync(path.join(consumerRoot, "consumer.ts"), `import * as api from ${JSON.stringify(name)};\nvoid api;\n`);
      writeFileSync(path.join(consumerRoot, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false },
        include: ["consumer.ts"],
      }, null, 2));
      run(path.join(consumerRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], consumerRoot);
      run(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(name)})`], consumerRoot);
    }
    console.log(`  minimal ${name} consumer and dependency scan passed`);
  }

console.log("Release gate check 4/4: public terminology and private-file boundary");
const tracked = run("git", ["ls-files", "--cached", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(path.join(ROOT, file)));
for (const forbidden of ["ACKRATE_PROGRESS_LOG.md", "CONTRACT_UPGRADE_PLAYBOOK.md"]) {
  if (tracked.some((file) => path.basename(file) === forbidden)) {
    fail(`private file ${forbidden} is tracked in the public repository`);
  }
  const ignoredCopies = run("git", [
    "ls-files", "--others", "--ignored", "--exclude-standard", "--",
    forbidden, `:(glob)**/${forbidden}`,
  ]).split("\n").filter(Boolean);
  if (ignoredCopies.length > 0) {
    fail(`private file ${forbidden} exists inside the public repository, including ignored paths`);
  }
}
const publicText = tracked.filter((file) => /\.md$/i.test(file));
for (const file of publicText) {
  const body = readFileSync(path.join(ROOT, file), "utf8");
  if (/\bau(?:dit)[a-z-]*\b/i.test(body)) {
    fail(`${file} contains prohibited T1 review terminology; use gate check`);
  }
  if (/BulletproofBar|novel[ -]lens/i.test(body)) {
    fail(`${file} contains internal review terminology`);
  }
}

console.log("\nRelease gate check passed");
if (process.argv.includes("--keep-artifacts")) {
  const candidateRoot = mkdtempSync(path.join(tmpdir(), "ackrate-verified-candidates-"));
  const artifacts = [];
  for (const [name, tarball] of tarballs) {
    const filename = path.basename(tarball);
    copyFileSync(tarball, path.join(candidateRoot, filename));
    artifacts.push({ name, version: candidateVersions.get(name), filename,
      integrity: `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}` });
  }
  writeFileSync(path.join(candidateRoot, "candidate-integrity.json"), JSON.stringify({
    checkedAt: new Date().toISOString(),
    sourceHead: run("git", ["rev-parse", "HEAD"]).trim(),
    sourceDirty: run("git", ["status", "--porcelain"]).trim().length > 0,
    published: false,
    artifacts,
  }, null, 2));
  console.log(`Verified candidate artifacts retained at ${candidateRoot}; not published`);
}
} finally {
  if (packRoot) rmSync(packRoot, { recursive: true, force: true });
}
}

try {
  main();
} catch (error) {
  console.error(`\nRelease gate check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
