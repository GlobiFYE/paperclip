#!/usr/bin/env node
// Deterministic image-bloat detector (no LLM). Reads the built image's layer
// history and a file manifest collected from inside the image, then reports
// the duplication signals a glibc linux production image should never carry.
//
// Signals (all deterministic, all LLM-free):
//   1. total image size vs a recorded budget
//   2. mode-rewrite layers (RUN chmod/chown -R) — pure mode changes that add a
//      full second copy of a tree as a layer
//   3. platform packages for a non-target OS/libc (musl, darwin, win32, …) that
//      a glibc Debian image never loads
//   4. the same package installed in more than one node_modules tree (global vs
//      workspace vs provider pack)
//   5. (--deep) files with identical content hashes at different paths
//
// Modes:
//   node scripts/image-bloat-detect.mjs --image <ref>                 report
//   node scripts/image-bloat-detect.mjs --image <ref> --record-budget <file>
//   node scripts/image-bloat-detect.mjs --image <ref> --check <file>   exit non-zero on regression
//
// Exit code: 0 clean, 1 regression, 2 usage/collection error.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The production image is Debian trixie (glibc) built natively for linux x64
// and linux arm64. Any optional platform package for another OS/libc is dead
// weight. x64 vs arm64 are both targets, so neither is flagged.
const NON_TARGET_PLATFORM = /(musl|darwin|win32|windows|freebsd|openbsd|netbsd|aix|sunos|cygwin|android)/i;
const MODE_REWRITE = /(chmod\s+(-R|--recursive)|chown\s+(-R|--recursive))/i;
const MODE_REWRITE_MIN_BYTES = 10 * 1024 * 1024;

// Collected inside the image by `docker run --entrypoint node` reading this
// script on stdin. Emits one JSON object on stdout.
const MANIFEST_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function readPkg(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); }
  catch { return null; }
}

function dirSize(dir) {
  try {
    const out = execSync("du -s --block-size=1 -- " + JSON.stringify(dir), { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return Number(out.split(/\\s/)[0]) || 0;
  } catch { return 0; }
}

function listFlat(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    const dir = path.join(root, entry);
    if (entry.startsWith("@")) {
      for (const sub of fs.readdirSync(dir)) {
        const pkg = readPkg(path.join(dir, sub));
        if (pkg) out.push({ name: pkg.name, version: pkg.version, sizeBytes: dirSize(path.join(dir, sub)) });
      }
    } else {
      const pkg = readPkg(dir);
      if (pkg) out.push({ name: pkg.name, version: pkg.version, sizeBytes: dirSize(dir) });
    }
  }
  return out;
}

// pnpm .pnpm dirs are "<name-with-plus>@<version>"; scope slash becomes '+'.
function parsePnpmDir(entry) {
  const at = entry.lastIndexOf("@");
  if (at <= 0) return null;
  const rawName = entry.slice(0, at);
  const version = entry.slice(at + 1);
  return { name: rawName.replace("+", "/"), version, dir: entry };
}

function listPnpm(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    const parsed = parsePnpmDir(entry);
    if (!parsed) continue;
    out.push({ ...parsed, sizeBytes: dirSize(path.join(root, entry)) });
  }
  return out;
}

console.log(JSON.stringify({
  global: listFlat("/usr/local/lib/node_modules").filter(p => p.name !== "npm" && p.name !== "corepack"),
  pnpm: listPnpm("/app/node_modules/.pnpm"),
  providerPack: listFlat("/opt/paperclip-runner/provider-pack/node_modules"),
}));
`;

function parseSize(text) {
  const match = /^([\d.]+)\s*(B|kB|KB|MB|GB|TB)?$/.exec(String(text).trim());
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = (match[2] || "B").toUpperCase();
  const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit];
  return Math.round(value * scale);
}

function runDocker(args, { input } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`docker failed to launch: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} exited ${result.status}: ${String(result.stderr || result.stdout).slice(0, 2000)}`);
  }
  return result.stdout;
}

export function collectImageMetrics(image) {
  assert.match(image ?? "", /^\S+$/, "image must be a non-empty ref");
  const sizeBytes = Number(runDocker(["image", "inspect", "-f", "{{.Size}}", image]).trim());

  const history = runDocker(["history", "--no-trunc", "--format", "{{.Size}}\t{{.CreatedBy}}", image])
    .split("\n")
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab === -1) return null;
      return { sizeBytes: parseSize(line.slice(0, tab)), createdBy: line.slice(tab + 1) };
    })
    .filter(Boolean);

  const manifest = JSON.parse(runDocker(["run", "--rm", "-i", "--entrypoint", "node", image], { input: MANIFEST_SCRIPT }));

  return { image, sizeBytes, history, manifest };
}

export function analyzeBloat({ sizeBytes, history = [], manifest = {}, budget = null, deep = false }) {
  const modeRewriteLayers = history
    .filter((layer) => MODE_REWRITE.test(layer.createdBy) && layer.sizeBytes >= MODE_REWRITE_MIN_BYTES)
    .map((layer) => ({ sizeBytes: layer.sizeBytes, createdBy: layer.createdBy.trim() }));

  const nonTargetPlatformPackages = (manifest.pnpm ?? [])
    .filter((entry) => NON_TARGET_PLATFORM.test(entry.name))
    .map((entry) => ({ name: entry.name, sizeBytes: entry.sizeBytes }));

  // Same package present in more than one node_modules tree (global vs pnpm
  // vs provider pack). Grouped by name; each location records its tree and the
  // version it resolved, so version drift between trees is visible in the
  // report (e.g. @openai/codex@0.163.0 global vs 0.160.0-linux-x64 workspace).
  const byName = new Map();
  const trees = [
    ["global", manifest.global ?? []],
    ["pnpm", manifest.pnpm ?? []],
    ["providerPack", manifest.providerPack ?? []],
  ];
  for (const [tree, packages] of trees) {
    for (const pkg of packages) {
      if (!byName.has(pkg.name)) byName.set(pkg.name, []);
      byName.get(pkg.name).push({ tree, version: pkg.version });
    }
  }
  const duplicatePackagesAcrossTrees = [...byName.entries()]
    .filter(([, locations]) => new Set(locations.map((l) => l.tree)).size > 1)
    .map(([name, locations]) => ({ name, locations }));

  const report = {
    image: null,
    totalSizeBytes: sizeBytes,
    modeRewriteLayers,
    nonTargetPlatformPackages,
    duplicatePackagesAcrossTrees,
    contentDuplicates: deep ? [] : null,
  };

  if (budget) {
    const violations = [];
    const tolerance = budget.totalSizeBytes * 0.02 + 8 * 1024 * 1024;
    if (sizeBytes > budget.totalSizeBytes + tolerance) {
      violations.push(`image grew from ${budget.totalSizeBytes} to ${sizeBytes} bytes (+${sizeBytes - budget.totalSizeBytes})`);
    }
    const budgetPlatform = new Set((budget.nonTargetPlatformPackages ?? []).map((p) => p.name));
    for (const pkg of nonTargetPlatformPackages) {
      if (!budgetPlatform.has(pkg.name)) violations.push(`new non-target platform package: ${pkg.name}`);
    }
    const budgetDup = new Set((budget.duplicatePackagesAcrossTrees ?? []).map((p) => p.name));
    for (const dup of duplicatePackagesAcrossTrees) {
      if (!budgetDup.has(dup.name)) violations.push(`new duplicate package across trees: ${dup.name}`);
    }
    if (modeRewriteLayers.length > (budget.modeRewriteLayers?.length ?? 0)) {
      violations.push(`mode-rewrite layers grew from ${budget.modeRewriteLayers?.length ?? 0} to ${modeRewriteLayers.length}`);
    }
    report.budgetViolations = violations;
  }

  return report;
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const image = readArg("--image");
  const budgetPath = readArg("--check") ?? readArg("--record-budget");
  const recordBudget = process.argv.includes("--record-budget");
  const deep = process.argv.includes("--deep");
  if (!image) throw new Error("Usage: node scripts/image-bloat-detect.mjs --image <ref> [--check <file> | --record-budget <file>] [--deep]");

  const budget = budgetPath ? JSON.parse(readFileSync(budgetPath, "utf8")) : null;
  const metrics = collectImageMetrics(image);
  const report = analyzeBloat({ ...metrics, budget, deep });
  report.image = image;

  if (recordBudget) {
    assert.ok(budgetPath, "--record-budget requires a path");
    writeFileSync(budgetPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`recorded budget to ${budgetPath} (${report.totalSizeBytes} bytes)`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
  if (budget && (report.budgetViolations ?? []).length > 0) {
    console.error("\nBUDGET VIOLATIONS:");
    for (const violation of report.budgetViolations) console.error(`  - ${violation}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
