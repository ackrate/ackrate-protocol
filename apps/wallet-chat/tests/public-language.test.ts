import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const publicRoots = ["app", "components", "lib", ".env.example", "README.md"];
const forbidden = ["tranche", "milestone", "grant review", "grant reviewer"];

function files(path: string): string[] {
  const full = resolve(root, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => files(resolve(path, entry)));
}

test("public wallet surfaces contain product language only", () => {
  for (const file of publicRoots.flatMap(files).filter((name) => /\.(?:ts|tsx|md|example)$/.test(name))) {
    const content = readFileSync(file, "utf8").toLowerCase();
    for (const term of forbidden) assert.equal(content.includes(term), false, `${file} contains forbidden internal term ${term}`);
  }
});
