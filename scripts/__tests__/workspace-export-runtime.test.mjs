import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (relativePath) => JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
const packageJson = readJson("package.json");
const serverPackageJson = readJson("server/package.json");
const dbPackageJson = readJson("packages/db/package.json");

const sourceExportPackages = [
  "packages/adapter-utils/package.json",
  "packages/adapters/claude-local/package.json",
  "packages/adapters/codex-local/package.json",
  "packages/adapters/cursor-cloud/package.json",
  "packages/adapters/cursor-local/package.json",
  "packages/adapters/gemini-local/package.json",
  "packages/adapters/grok-local/package.json",
  "packages/adapters/hermes/package.json",
  "packages/adapters/kimi-local/package.json",
  "packages/adapters/openclaw-gateway/package.json",
  "packages/adapters/opencode-local/package.json",
  "packages/adapters/pi-local/package.json",
  "packages/db/package.json",
  "packages/shared/package.json",
  "packages/skills-catalog/package.json",
  "server/package.json",
];
const staticExportSubpaths = new Set(["./ui-parser", "./gateway/ui-parser", "./package.json", "./catalog.json"]);

function assertConditionalExport(value, label) {
  assert.equal(typeof value, "object", `${label} must use conditional exports`);
  if (value.types.startsWith("./src/")) {
    assert.match(value.development, /^\.\/src\//, `${label} must keep development source`);
  } else {
    assert.equal(value.development, value.types, `${label} must keep generated development data`);
  }
  assert.match(value.import, /^\.\/dist\//, `${label} must use compiled imports`);
}

test("workspace production exports keep source development paths and compiled imports", () => {
  for (const relativePath of sourceExportPackages) {
    const manifest = readJson(relativePath);
    for (const [subpath, value] of Object.entries(manifest.exports)) {
      if (staticExportSubpaths.has(subpath)) continue;
      assertConditionalExport(value, `${relativePath} ${subpath}`);
    }
  }
});

test("Docker builds UI dependencies before the UI bundle", () => {
  const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
  const dependencyBuild = dockerfile.indexOf("RUN pnpm --filter @paperclipai/ui^... build");
  const pluginSdkBuild = dockerfile.indexOf("RUN pnpm --filter @paperclipai/plugin-sdk build");
  const uiBuild = dockerfile.indexOf("RUN pnpm --filter @paperclipai/ui build");
  const serverBuild = dockerfile.indexOf("RUN pnpm --filter @paperclipai/server build");
  assert.ok(dependencyBuild >= 0, "Dockerfile must build UI workspace dependencies");
  assert.ok(pluginSdkBuild > dependencyBuild, "plugin SDK must build after UI dependencies");
  assert.ok(uiBuild > pluginSdkBuild, "UI must build after its workspace dependencies");
  assert.ok(serverBuild > uiBuild, "server must build after the UI");
});

test("database migration commands enable source workspace exports", () => {
  assert.match(packageJson.scripts["db:migrate"], /^cross-env NODE_OPTIONS=--conditions=development /);
  assert.match(dbPackageJson.scripts.migrate, /cross-env NODE_OPTIONS=--conditions=development/);
  const probe = spawnSync(
    process.execPath,
    ["--conditions=development", "--import", join(repoRoot, "cli/node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e", "import('./packages/db/src/runtime-config.ts').then(() => process.stdout.write('ok'))"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, "ok");
});

test("development condition scripts are Windows-compatible", () => {
  const manifests = [packageJson, serverPackageJson, dbPackageJson];
  for (const manifest of manifests) {
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      assert.equal(
        command.trimStart().startsWith("NODE_OPTIONS="),
        false,
        `${manifest.name} ${name} must use cross-env instead of a POSIX environment prefix`,
      );
    }
  }
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (command.includes("conditions=development")) assert.match(command, /cross-env NODE_OPTIONS=/, name);
  }
  assert.match(serverPackageJson.scripts.dev, /cross-env NODE_OPTIONS=/);
  assert.match(dbPackageJson.scripts.migrate, /cross-env NODE_OPTIONS=/);
});

test("test subprocess entrypoints select development workspace exports", () => {
  const stableRunner = readFileSync(join(repoRoot, "scripts/run-vitest-stable.mjs"), "utf8");
  const playwrightConfig = readFileSync(join(repoRoot, "tests/e2e/playwright.config.ts"), "utf8");
  assert.match(stableRunner, /NODE_OPTIONS: \[process\.env\.NODE_OPTIONS\?\.trim\(\), "--conditions=development"\]/);
  assert.match(playwrightConfig, /"--conditions=development"/);
});
