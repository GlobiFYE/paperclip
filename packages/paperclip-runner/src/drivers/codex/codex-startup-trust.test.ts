import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { deepStrictEqual } from "node:assert";
import { describe, it, expect } from "vitest";
import { parse } from "smol-toml";
import { trustCodexStartupRoot } from "./codex-startup-trust.js";

describe("isolated Codex startup trust", () => {
  it.each(["missing", "table", "empty-table", "inline", "empty-inline", "inline-projects", "trusted"])(
    "preserves managed comments and unrelated content with %s project configuration", (kind) => {
      const temp = realpathSync(mkdtempSync(join(tmpdir(), "codex-trust-comments-")));
      try {
        const cwd = join(temp, "project"); const home = join(temp, "home");
        mkdirSync(cwd); mkdirSync(home);
        const root = JSON.stringify(cwd);
        const project = {
          missing: "",
          table: `[projects.${root}]\ntrust_level = "untrusted" # retain trust comment\n`,
          "empty-table": `[projects.${root}] # retain table comment\n`,
          inline: `[projects]\n${root} = {trust_level = 'untrusted', label = "unchanged"}\n`,
          "empty-inline": `[projects]\n${root} = {} # retain inline comment\n`,
          "inline-projects": `projects = {${root} = {label = "unchanged"}}\n`,
          trusted: `[projects.${root}]\ntrust_level = "trusted" # retain trust comment\n`,
        }[kind]!;
        const managed = '# BEGIN PAPERCLIP MANAGED MCP\n[mcp_servers.fixture]\nurl = "https://example.invalid/old"\n# END PAPERCLIP MANAGED MCP\n';
        const misleading = 'text = """\n[projects.fake]\ntrust_level = "untrusted"\n"""\n';
        const original = (kind === "inline-projects" ? project + misleading : misleading + project) + managed;
        writeFileSync(join(home, "config.toml"), original);
        const expected = parse(original);
        expected.projects ??= {};
        const projects = expected.projects as Record<string, Record<string, unknown>>;
        projects[cwd] = { ...projects[cwd], trust_level: "trusted" };
        trustCodexStartupRoot(home, cwd);
        const updated = readFileSync(join(home, "config.toml"), "utf8");
        expect(parse(updated)).toEqual(expected);
        expect(updated).toContain(managed);
        expect(updated).toContain(misleading);
        if (kind === "trusted") expect(updated).toBe(original);
        trustCodexStartupRoot(home, cwd);
        expect(readFileSync(join(home, "config.toml"), "utf8")).toBe(updated);
        const refreshed = updated.replace(managed, managed.replace('/old', '/new'));
        expect((parse(refreshed).mcp_servers as Record<string, {url: string}>).fixture.url).toBe('https://example.invalid/new');
      } finally { rmSync(temp, { recursive: true, force: true }); }
    },
  );

  it.each(["missing", "untrusted", "trusted"])(
    "preserves nested TOML values and sibling trust with target trust %s",
    (trust) => {
      const temp = realpathSync(mkdtempSync(join(tmpdir(), "codex-trust-values-")));
      try {
        const cwd = join(temp, "project");
        const home = join(temp, "home");
        mkdirSync(cwd);
        mkdirSync(home);
        const unrelated = [
          'special = [nan, inf, -inf, -0.0]',
          'created = 2026-10-12T19:04:14Z',
          'local_date = 2026-10-12',
          'local_time = 19:04:14',
          '[projects."/unrelated"]',
          'trust_level = "untrusted"',
          'settings = { __proto__ = { keep = true }, constructor = { name = "unchanged" } }',
          '[[mcp_servers.fixture.entries]]',
          'name = "unchanged"',
          '',
        ].join("\n");
        const target = trust === "missing" ? "" : [
          `[projects.${JSON.stringify(cwd)}]`,
          `trust_level = "${trust}" # retain target comment`,
          `[projects.${JSON.stringify(cwd)}.settings]`,
          'nested = { __proto__ = { keep = true }, values = [nan, -0.0] }',
          '',
        ].join("\n");
        const original = unrelated + target;
        writeFileSync(join(home, "config.toml"), original);

        trustCodexStartupRoot(home, cwd);

        const updated = readFileSync(join(home, "config.toml"), "utf8");
        expect(updated.startsWith(unrelated)).toBe(true);
        if (trust !== "missing") {
          expect(updated).toBe(unrelated + target.replace(
            'trust_level = "untrusted"', 'trust_level = "trusted"',
          ));
        }
        const expected = parse(original);
        const actual = parse(updated);
        const projects = actual.projects as Record<string, Record<string, unknown>>;
        expect(projects[cwd].trust_level).toBe("trusted");
        if (trust === "missing") delete projects[cwd];
        else projects[cwd].trust_level = trust;
        deepStrictEqual(actual, expected);
        trustCodexStartupRoot(home, cwd);
        expect(readFileSync(join(home, "config.toml"), "utf8")).toBe(updated);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    },
  );

  it("trusts the exact non-Git root and preserves unrelated config", () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "codex-trust-")));
    try {
      const cwd = join(temp, "project");
      const home = join(temp, "home");
      mkdirSync(cwd);
      mkdirSync(home);
      writeFileSync(
        join(home, "config.toml"),
        'model = "test"\n[mcp_servers.fixture]\nurl = "http://localhost/example"\n',
      );
      trustCodexStartupRoot(home, cwd);
      trustCodexStartupRoot(home, cwd);
      expect(parse(readFileSync(join(home, "config.toml"), "utf8"))).toEqual({
        model: "test",
        mcp_servers: { fixture: { url: "http://localhost/example" } },
        projects: { [cwd]: { trust_level: "trusted" } },
      });
      expect(readFileSync(join(home, "config.toml"), "utf8")).not.toContain(
        `[projects."${temp}"]`,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("uses the canonical main repository key for worktrees and symlinks", () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "codex-trust-")));
    try {
      const main = join(temp, "main");
      const worktree = join(temp, "branch");
      const home = join(temp, "home");
      mkdirSync(main);
      execFileSync("git", ["init", main], { stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-C",
          main,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "init",
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "git",
        ["-C", main, "worktree", "add", "-b", "test", worktree],
        { stdio: "ignore" },
      );
      symlinkSync(worktree, join(temp, "alias"));
      trustCodexStartupRoot(home, join(temp, "alias"));
      expect(
        parse(readFileSync(join(home, "config.toml"), "utf8")).projects,
      ).toEqual({ [main]: { trust_level: "trusted" } });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("fails without replacing malformed configuration", () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "codex-trust-")));
    try {
      writeFileSync(join(temp, "config.toml"), "invalid = [");
      expect(() => trustCodexStartupRoot(temp, temp)).toThrow();
      expect(readFileSync(join(temp, "config.toml"), "utf8")).toBe(
        "invalid = [",
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
