import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withoutHistoricalWireIdentifiers } from "./branding-policy.mjs";

const identifiers = JSON.parse(readFileSync(new URL("./legacy-wire-identifiers.json", import.meta.url)));
const format = "packages/ap2/src/v02/legacy-wire-format.ts";
test("historical wire exceptions require an exact literal and exact format path", () => {
  for (const value of identifiers) {
    const literal = JSON.stringify(value);
    assert.equal(withoutHistoricalWireIdentifiers(literal, format), '"<historical-wire-identifier>"');
    assert.equal(withoutHistoricalWireIdentifiers(literal, "packages/ap2/src/v02/merchant.ts"), literal);
    const changed = JSON.stringify(`${value}-changed`);
    assert.equal(withoutHistoricalWireIdentifiers(changed, format), changed);
  }
  const comment = identifiers.find((value) => !value.includes("\0"));
  assert.equal(withoutHistoricalWireIdentifiers(`// ${comment}`, format), `// ${comment}`);
});
test("historical wire source-map escaping preserves the same exact-value restriction", () => {
  for (const value of identifiers) {
    const literal = JSON.stringify(JSON.stringify(value)).slice(1, -1);
    assert.equal(withoutHistoricalWireIdentifiers(literal, "packages/ap2/dist/v02/legacy-wire-format.js.map"),
      '<historical-wire-identifier>');
  }
});
