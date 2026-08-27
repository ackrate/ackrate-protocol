#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = "/tmp/ackrate-release-npm-cache";

const packages = [
  ["packages/stellar", "@ackrate/stellar", "0.2.5"],
  ["packages/sdk", "@ackrate/core", "0.3.3"],
  ["packages/ap2", "@ackrate/ap2", "0.3.2"],
  ["packages/express-middleware", "@ackrate/express-middleware", "0.2.4"],
  ["packages/cli", "@ackrate/cli", "0.1.10"],
];
const OBSOLETE_BRAND = new RegExp(["re", "app"].join(""), "i");

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
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? "an execution error"}`);
  }
  return result.stdout;
}

function main() {
let packRoot;
try {
console.log("Release gate check 1/4: clean contract and workspace verification");
run(process.execPath, ["scripts/verify.mjs"]);
run("npm", ["run", "cli:bundle"]);

console.log("Release gate check 2/4: public package manifests and tarball contents");
packRoot = mkdtempSync(path.join(tmpdir(), "ackrate-release-pack-"));
const tarballs = new Map();
for (const [directory, expectedName, expectedVersion] of packages) {
  const packageRoot = path.join(ROOT, directory);
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
    fail(`${directory} is ${manifest.name}@${manifest.version}, expected ${expectedName}@${expectedVersion}`);
  }
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
    if (OBSOLETE_BRAND.test(body)) {
      fail(`${expectedName} tarball contains obsolete branding in ${artifactFile}`);
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
import { TESTNET } from "@ackrate/stellar";
import { createAp2ComplianceValidator, InMemoryAp2ReplayStore } from "@ackrate/ap2";
import { createBoundAckratePaidJsonRoute, InMemoryBoundRedemptionStore } from "@ackrate/express-middleware";

void [ackrate, DeliveryPendingError, TESTNET];
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
await Promise.all([
  import("@ackrate/core"), import("@ackrate/stellar"),
  import("@ackrate/ap2"), import("@ackrate/express-middleware"),
]);
console.log("runtime imports passed");
`);
  run(path.join(installRoot, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], installRoot);
  run(process.execPath, ["runtime.mjs"], installRoot);
  const cliVersion = run(path.join(installRoot, "node_modules", ".bin", "ackrate"), ["--version"], installRoot).trim();
  if (cliVersion !== "0.1.10") fail(`clean-installed CLI reported ${JSON.stringify(cliVersion)}`);
  console.log("  clean install, strict types, ESM imports, and CLI executable passed");

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
