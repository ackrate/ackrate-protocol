#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_BRAND_FORMS = [
  ["re", "app"].join(""),
  ["RE", "APP"].join(""),
  ["Re", "app"].join(""),
];
const SKIP_DIRECTORIES = new Set([".git", ".next", "node_modules", "target"]);
const SKIP_EXTENSIONS = new Set([".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".wasm", ".webp"]);
const matches = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(ROOT, absolute);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      visit(absolute);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = lstatSync(absolute);
      if (!target.isFile()) continue;
    }
    if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const body = readFileSync(absolute, "utf8");
    if (RETIRED_BRAND_FORMS.some((form) => body.includes(form) || relative.includes(form))) {
      matches.push(relative);
    }
  }
}

visit(ROOT);
if (matches.length > 0) {
  console.error(`Retired brand remains in ${matches.length} path(s):\n${matches.join("\n")}`);
  process.exit(1);
}
console.log("Brand check passed: no retired-name occurrences in source or first-party build output.");
