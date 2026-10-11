/**
 * link-cli-externals.mjs — make the repo-built CLI runnable from the checkout.
 *
 * The published `paperclipai` npm package declares the esbuild bundle's
 * external npm dependencies (see scripts/generate-npm-package-json.mjs) so
 * `node_modules/.bin/paperclipai` resolves them after `npm install`. The dev
 * package.json deliberately omits those runtime deps, so running
 * `node cli/dist/index.js` directly from a workspace checkout fails with
 * ERR_MODULE_NOT_FOUND (e.g. "Cannot find package 'zod'").
 *
 * This script computes the exact external set the same way
 * cli/esbuild.config.mjs does, then symlinks each package into
 * cli/node_modules/ so Node's ESM resolution from cli/dist/index.js finds it.
 * The donors are the workspace packages that declared the dependency, so the
 * linked copies are the exact versions pnpm resolved. Run it after
 * `pnpm install && pnpm build`. Idempotent.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const bundledCliNpmDependencies = new Set(["acpx", "embedded-postgres"]);
const workspacePaths = [
  "cli",
  "packages/db",
  "packages/shared",
  "packages/adapter-utils",
  "packages/adapters/claude-local",
  "packages/adapters/codex-local",
  "packages/adapters/hermes-gateway",
  "packages/adapters/hermes",
  "packages/adapters/openclaw-gateway",
];
const externalWorkspacePackages = new Set(["@paperclipai/server"]);
// Workspace dir per published workspace package name.
const externalWorkspaceDirs = new Map([["@paperclipai/server", "server"]]);

/** Find the package root that owns a resolved entry file.
 * Walk up past sub-directory package.json stubs (e.g. postgres/cjs, which
 * carries a type-only package.json with no "name") to the real package root. */
function packageRootFromEntry(entryPath) {
  let fallback = null;
  let dir = dirname(entryPath);
  for (let i = 0; i < 8; i += 1) {
    const pkgJson = resolve(dir, "package.json");
    if (existsSync(pkgJson)) {
      if (!fallback) fallback = dir;
      try {
        const parsed = JSON.parse(readFileSync(pkgJson, "utf8"));
        if (parsed && typeof parsed.name === "string" && parsed.name.length > 0) return dir;
      } catch {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback ?? dirname(entryPath);
}

function resolvePackageRoot(name, fromDir) {
  const req = createRequire(resolve(fromDir, "package.json"));
  try {
    return packageRootFromEntry(req.resolve(`${name}/package.json`));
  } catch {
    return packageRootFromEntry(req.resolve(name));
  }
}

// externals: name -> donor workspace dir (the package that declared it)
const externals = new Map();
for (const p of workspacePaths) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, p, "package.json"), "utf8"));
  for (const name of Object.keys(pkg.dependencies || {})) {
    if (externalWorkspacePackages.has(name)) {
      if (!externals.has(name)) externals.set(name, p);
    } else if (!name.startsWith("@paperclipai/") && !bundledCliNpmDependencies.has(name)) {
      if (!externals.has(name)) externals.set(name, p);
    }
  }
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    if (!externals.has(name)) externals.set(name, p);
  }
}
for (const name of externalWorkspacePackages) {
  if (!externals.has(name)) externals.set(name, externalWorkspaceDirs.get(name) ?? "cli");
}

// embedded-postgres optional deps (platform PG binaries) resolve from the
// embedded-postgres package itself, exactly like cli/esbuild.config.mjs.
const requireFromDb = createRequire(resolve(repoRoot, "packages/db/package.json"));
const embeddedPostgresRoot = dirname(requireFromDb.resolve("embedded-postgres"));
const embeddedPostgresPackage = JSON.parse(
  readFileSync(resolve(embeddedPostgresRoot, "..", "package.json"), "utf8"),
);
for (const name of Object.keys(embeddedPostgresPackage.optionalDependencies ?? {})) {
  if (!externals.has(name)) externals.set(name, resolve(embeddedPostgresRoot, ".."));
}

const cliNodeModules = resolve(repoRoot, "cli/node_modules");
mkdirSync(cliNodeModules, { recursive: true });

// NOTE: workspace packages are plain symlinks here. They resolve to their
// built dist at runtime via the `pantheon-dist` export condition (see each
// package.json `exports`), enabled with --conditions=pantheon-dist.

let linked = 0;
let skipped = 0;
const missing = [];
for (const [name, donorDir] of [...externals.entries()].sort()) {
  const target = resolve(cliNodeModules, name);
  let root;
  if (externalWorkspaceDirs.has(name)) {
    // Known workspace package: link straight at its workspace dir (resolution
    // would be circular — the link itself is what makes the name resolvable).
    root = resolve(repoRoot, externalWorkspaceDirs.get(name));
  } else {
    try {
      root = resolvePackageRoot(name, resolve(repoRoot, donorDir));
    } catch (err) {
      missing.push(`${name} (donor ${donorDir}: ${err.code ?? err.message})`);
      continue;
    }
  }
  if (existsSync(target)) {
    skipped += 1;
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    symlinkSync(root, target, "dir");
    linked += 1;
  } catch (err) {
    if (err.code === "EEXIST") {
      skipped += 1;
    } else {
      missing.push(`${name} (symlink failed: ${err.code ?? err.message})`);
    }
  }
}

console.log(`link-cli-externals: linked=${linked} already-present=${skipped} unresolved=${missing.length}`);
for (const line of missing) console.log(`  ! ${line}`);
if (missing.length > 0) process.exitCode = 1;
