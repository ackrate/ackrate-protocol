import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Workspace dependencies are hoisted, so npm pack cannot bundle them directly
// from a workspace. Stage only npm's public file list and install the explicitly
// bundled upstream dependencies in isolation. Consumers receive the checked
// dependency bytes; repository overrides are never required in their project.
export function preparePackageBundle(packageRoot, destination, run, overrides) {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const bundled = manifest.bundleDependencies;
  if (!Array.isArray(bundled) || bundled.length === 0) {
    throw new Error(`${manifest.name} must declare its bundled dependencies`);
  }
  const publicFiles = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], packageRoot))[0];
  mkdirSync(destination, { recursive: true });
  for (const { path: file } of publicFiles.files) {
    if (file.startsWith("node_modules/")) continue;
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(packageRoot, file), target);
  }
  // Install only the upstream bundle, never unpublished Ackrate packages or
  // development dependencies. Restore the exact public manifest before packing.
  writeFileSync(path.join(destination, "package.json"), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    private: true,
    dependencies: Object.fromEntries(bundled.map((name) => {
      const version = manifest.dependencies?.[name];
      if (!version) throw new Error(`${manifest.name} cannot bundle undeclared ${name}`);
      return [name, version];
    })),
    overrides,
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--no-fund"], destination);
  run("npm", ["audit", "--audit-level=high"], destination);
  copyFileSync(path.join(packageRoot, "package.json"), path.join(destination, "package.json"));
  return destination;
}
