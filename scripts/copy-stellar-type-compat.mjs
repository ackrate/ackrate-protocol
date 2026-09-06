import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

// TypeScript preserves the public reference but does not copy input .d.ts files.
copyFileSync(
  new URL("../packages/stellar/src/xdr-types.d.ts", import.meta.url),
  new URL("../packages/stellar/dist/xdr-types.d.ts", import.meta.url),
);
copyFileSync(
  new URL("../packages/stellar/STELLAR-SDK-LICENSE", import.meta.url),
  new URL("../packages/stellar/dist/STELLAR-SDK-LICENSE", import.meta.url),
);
const entrypoint = new URL("../packages/stellar/dist/index.d.ts", import.meta.url);
const declarations = readFileSync(entrypoint, "utf8");
const sourceReference = '/// <reference path="../src/xdr-types.d.ts" preserve="true" />';
if (!declarations.startsWith(sourceReference)) {
  throw new Error("Stellar compatibility declaration reference was not emitted as expected");
}
writeFileSync(entrypoint, declarations.replace(sourceReference,
  '/// <reference path="./xdr-types.d.ts" preserve="true" />'));
