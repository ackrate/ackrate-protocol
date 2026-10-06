import { readFileSync } from "node:fs";

const identifiers = JSON.parse(readFileSync(new URL("./legacy-wire-identifiers.json", import.meta.url), "utf8"));
const historicalFormatFiles = new Set([
  "scripts/legacy-wire-identifiers.json",
  "packages/ap2/src/v02/legacy-wire-format.ts",
  "packages/ap2/dist/v02/legacy-wire-format.js",
  "packages/ap2/dist/v02/legacy-wire-format.d.ts",
  "packages/ap2/dist/v02/legacy-wire-format.js.map",
]);

// Exempt only complete, fixed historical wire values in their dedicated module.
// A new name, comment, path or additional literal still fails the brand check.
export function withoutHistoricalWireIdentifiers(body, relative) {
  if (!historicalFormatFiles.has(relative)) return body;
  for (const value of identifiers) {
    const literal = JSON.stringify(value);
    // TypeScript declarations spell NUL as \0, whereas JSON spells \u0000.
    for (const spelling of [literal, literal.replaceAll("\\u0000", "\\0")]) {
      body = body.replaceAll(spelling, '"<historical-wire-identifier>"');
      body = body.replaceAll(JSON.stringify(spelling).slice(1, -1), '<historical-wire-identifier>');
    }
  }
  return body;
}
