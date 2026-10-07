#!/usr/bin/env node
/**
 * Local TypeScript CI gate. Run before every push (also wired as a git
 * pre-push hook) so no commit that would fail CI ever reaches the remote.
 *
 *   npm run verify
 *
 * Mirrors the TypeScript job in .github/workflows/ci.yml (with a CLEAN workspace build,
 * since CI runs from a fresh checkout where each package's dist is absent).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === "path") ?? "PATH";
const ENV = { ...process.env, [pathKey]: [path.dirname(process.execPath), process.env[pathKey] ?? "", ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : [])].join(path.delimiter) };
// npm supplies its JavaScript entry point; invoking it through Node also works
// when Windows cannot spawn the npm.cmd shim directly.
const npmEntry = process.env.npm_execpath;
const NPM = (npmEntry && path.basename(npmEntry) === "npm-cli.js" ? npmEntry : undefined) ?? [path.dirname(process.execPath), ...(process.env[pathKey] ?? "").split(path.delimiter)]
  .map(dir => path.join(dir, "node_modules/npm/bin/npm-cli.js")).find(existsSync);

for (const name of readdirSync(path.join(ROOT, ".github", "workflows"))) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  const body = readFileSync(path.join(ROOT, ".github", "workflows", name), "utf8");
  for (const line of body.split("\n")) {
    const reference = line.match(/^\s*(?:-\s*)?uses:\s+\S+@([^\s#]+)/)?.[1];
    if (reference && !/^[0-9a-f]{40}$/.test(reference)) {
      console.error(`GitHub workflow ${name} contains a mutable action reference: @${reference}`);
      process.exit(1);
    }
  }
}

function run(label, cmd, args, cwd) {
  process.stdout.write(`\n▶ ${label}\n`);
  const useNpmEntry = cmd === "npm" && NPM;
  const res = spawnSync(useNpmEntry ? process.execPath : cmd, useNpmEntry ? [NPM, ...args] : args, { cwd, stdio: "inherit", env: ENV });
  if (res.error || res.status !== 0) {
    console.error(`\n✖ verify failed at: ${label}`);
    process.exit(1);
  }
}

// Rust source and contract gates live in ackrate-protocol-contracts.
// Workspaces (mirrors CI's TypeScript job — from a CLEAN build)
for (const workspace of [
  "packages/sdk",
  "packages/stellar",
  "packages/ap2",
  "packages/express-middleware",
  "packages/cli",
  "packages/ackrate-stellar-alias",
  "packages/ackrate-ap2-alias",
  "packages/ackrate-express-middleware-alias",
  "apps/consumer-agent",
  "apps/fulfillment-agent",
]) {
  rmSync(path.join(ROOT, workspace, "dist"), { recursive: true, force: true });
}
run("npm run build (clean)", "npm", ["run", "build"], ROOT);
run("strict root typecheck", "npm", ["run", "typecheck"], ROOT);
run("brand check", process.execPath, ["scripts/check-branding.mjs"], ROOT);
run("npm test", "npm", ["test"], ROOT);
run("npm audit (high/critical release stop)", "npm", ["audit", "--audit-level=high"], ROOT);

console.log("\n✓ verify passed — safe to push");
