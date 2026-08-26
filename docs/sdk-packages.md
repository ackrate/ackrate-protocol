# Installable, typed SDK packages

The packages are typed ESM implementations published under the `@ackrate` scope.
The `@ackrate` scope is unavailable to this project, so the packages map one-to-one:
`@ackrate/stellar` → `@ackrate/stellar`, `@ackrate/ap2` → `@ackrate/ap2`, and
`@ackrate/express-middleware` → `@ackrate/express-middleware`.

```bash
npm install @ackrate/stellar@0.2.5 @ackrate/ap2@0.3.2 @ackrate/express-middleware@0.2.4
```

Each package contains TypeScript declarations, API documentation, and a usage example
in its packed README. The gate check builds real tarballs for every public package,
installs all five into an empty project, strict-typechecks their public imports,
executes ESM imports and the CLI binary, and rejects lifecycle install scripts or
source/secret leakage.

## Evidence

```bash
npm ci
npm run gatecheck:release
```
