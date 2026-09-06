# Dependency compatibility for the current candidate

Updated on 2026-09-07. The source candidate moves the public packages to
`@stellar/stellar-sdk@16.3.0`, which requires Node.js 22 or later. This dependency
change is not yet evidence of a published Ackrate package release. Registry
packages and clean consumer installations must be checked separately.

SDK 16's `StellarToml.Resolver` imports `parse` from `smol-toml`. Moving to this
SDK dependency line removes the legacy `toml@3` parser from that path; the fix
does not depend on a consumer copying a repository-level TOML override.
Repository npm overrides do not propagate into an application that installs an
Ackrate library from npm.

`scripts/dependency-safety.test.mjs` resolves `smol-toml` from the installed SDK's
own dependency graph. It checks normal issuer metadata both directly and through
the actual SDK resolver using a local HTTP fixture. Hostile fixtures cover deeply
nested arrays and inline tables, invalid scalar-to-prototype traversal, and valid
tables named `__proto__` and `constructor.prototype`. The tests require controlled
parser errors for invalid input and verify that `Object.prototype` is unchanged;
prototype-like table names may remain ordinary document data. They do not depend
on the old parser's error messages.

The existing `qs` checks remain: normal query parsing, bracket-comma array limits,
and attacker-controlled `constructor.isBuffer` fields. These checks exercise the
installed `qs` implementation; the SDK migration does not itself change Express
query parsing or establish the dependency state of a published middleware package.

Run the dependency checks on Node.js 22 or later:

```bash
node --test scripts/dependency-safety.test.mjs
```

The resolver test opens a loopback HTTP server and makes no external request.
The synchronous parser and query tests can run separately where local ports are
unavailable:

```bash
node --test --test-name-pattern='smol-toml parser|^smol-toml|^qs' scripts/dependency-safety.test.mjs
```

The complete source gate and a fresh installation of the eventual published
artifacts remain release checks. Passing these targeted compatibility tests does
not establish that every dependency is free of known vulnerabilities.

## SDK 16.3.0 public declaration compatibility

Strict compilation of a clean packed consumer exposed a separate upstream
packaging issue. The installed `@stellar/stellar-sdk@16.3.0` public declarations
export `Hyper` and `UnsignedHyper` from `@stellar/js-xdr`, but do not bring the
SDK's shipped ambient declarations at `types/stellar__js-xdr/index.d.ts` into
the consumer's public type graph. The JavaScript implementation is present;
the missing declaration inclusion is the problem.

The source candidate supplies `packages/stellar/src/xdr-types.d.ts`, copied
from that exact upstream version with source and Apache-2.0 attribution.
Its declaration API matches the upstream file; only formatting and the
explanatory header differ. It does not substitute `any`, suppress a diagnostic,
change runtime XDR behavior, or change the contract/payment boundary.

The public Stellar binding entrypoint references the compatibility declaration.
`scripts/copy-stellar-type-compat.mjs` must ship it alongside the emitted entrypoint
and keep the emitted reference local to `dist`: `./xdr-types.d.ts`. TypeScript
can emit a reference to `../src/xdr-types.d.ts`, so preserving the source
reference and copying the file alone is insufficient. The npm package includes
`dist`, not `src`; a workspace-resolvable reference is not proof that a packed
consumer can resolve it.

The copied declaration must be distributed with the upstream SDK's full
`LICENSE` text and retained attribution. The npm manifest's
`"license": "Apache-2.0"` field is metadata, not a bundled license document;
there was no tracked repository license file available to supply it
automatically at this compatibility checkpoint. The packed artifact must
explicitly contain the license accompanying the copied declarations.

The release gate compiles packed-package consumers with `strict: true` and
`skipLibCheck: false`, including minimal package-specific consumer installations.
These settings must remain unchanged: enabling `skipLibCheck` to hide the
upstream packaging error is not the workaround. Existing workspace compilation
settings are not a substitute for this stricter consumer check. Verify the
tarball contains the declaration and license, that its public reference resolves
inside the tarball, and that strict compilation and runtime ESM imports pass
before marking this candidate ready for publication.

Keep this shim tied to the exact upstream SDK version. When changing that pin,
check whether the upstream public entrypoint now includes the declarations and
remove the shim when possible; loading two ambient copies may create duplicate
declarations. Successful local compatibility checks do not establish that the
candidate has been published or that older registry versions include the fix.
