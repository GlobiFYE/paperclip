import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readPackMetadata(packDestination: string) {
  const npmCliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const output = existsSync(npmCliPath)
    ? execFileSync(process.execPath, [npmCliPath, "pack", "--json", "--pack-destination", packDestination], {
        cwd: packageRoot,
        encoding: "utf8",
      })
    : execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["pack", "--json", "--pack-destination", packDestination],
        { cwd: packageRoot, encoding: "utf8", shell: process.platform === "win32" },
      );
  const metadata = JSON.parse(output);
  const entry = Array.isArray(metadata) ? metadata[0] : Object.values(metadata)[0];
  if (!entry || typeof entry?.filename !== "string") {
    throw new Error(`Unexpected npm pack output from ${packageRoot}: ${output}`);
  }
  return entry as { filename: string; files: Array<{ path: string }> };
}

describe("skills catalog package artifacts", () => {
  const cleanup: string[] = [];

  function createPackDestination() {
    const destination = mkdtempSync(path.join(tmpdir(), "paperclip-skills-catalog-pack-"));
    cleanup.push(destination);
    return destination;
  }

  afterEach(async () => {
    await Promise.all(cleanup.map((entry) => rm(entry, { force: true, recursive: true })));
    cleanup.length = 0;
  });

  it("packs dist manifest and catalog files for npm artifact consumers", () => {
    let metadata = readPackMetadata(createPackDestination());

    if (!metadata.files.some((entry) => entry.path === "dist/generated/catalog.json")) {
      execFileSync("pnpm", ["--filter", "@paperclipai/skills-catalog", "build"], {
        cwd: packageRoot,
        stdio: "ignore",
      });
      metadata = readPackMetadata(createPackDestination());
    }

    const paths = metadata.files.map((entry) => entry.path);

    expect(paths).toContain("dist/generated/catalog.json");
    expect(paths).toContain("generated/catalog.json");
    expect(paths).toContain("catalog/bundled/software-development/github-pr-workflow/SKILL.md");
    expect(paths).toContain("catalog/optional/browser/agent-browser/SKILL.md");
    expect(paths).toContain("package.json");
  }, 120_000);
});
