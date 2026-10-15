import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scripts = path.join(root, "scripts/ci-profile");

for (const framework of ["vitest", "playwright", "node"]) {
  test(`${framework} reports real file/test timestamps and preserves failing exit codes`, () => {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "ci-profile-smoke-")));
    try {
      symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
      const output = path.join(directory, "timings");
      const fixture = framework === "node"
        ? 'import { test } from "node:test";'
        : framework === "vitest" ? 'import { test } from "vitest";' : 'import { test } from "@playwright/test";';
      writeFileSync(path.join(directory, "probe.test.mjs"), `${fixture}
test("passing", async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
test("failing", async () => { throw new Error("expected probe failure"); });
`);
      let args;
      if (framework === "node") {
        args = [path.join(scripts, "node-test.mjs"), path.join(directory, "probe.test.mjs")];
      } else {
        const config = framework === "vitest"
          ? { test: { include: ["probe.test.mjs"], reporters: [path.join(scripts, "vitest-reporter.mjs")] } }
          : { testDir: directory, testMatch: "probe.test.mjs", workers: 1, retries: 0, reporter: [[path.join(scripts, "playwright-reporter.mjs")]] };
        const configFile = path.join(directory, `${framework}.config.mjs`);
        writeFileSync(configFile, `export default ${JSON.stringify(config)};`);
        args = framework === "vitest"
          ? [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", configFile, "--root", directory]
          : [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", configFile];
        args = [path.join(scripts, "run.mjs"), framework, process.execPath, ...args];
      }
      const start = Date.now();
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, args, {
        cwd: directory, encoding: "utf8", timeout: 30_000,
        env: { ...env, PAPERCLIP_CI_PROFILE: "true", PAPERCLIP_CI_PROFILE_DIR: output,
          PAPERCLIP_CI_PROFILE_JOB: "probe", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_WORKSPACE: directory },
      });
      const end = Date.now();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const records = readdirSync(output).flatMap((file) => readFileSync(path.join(output, file), "utf8").trim().split("\n").map(JSON.parse));
      const cases = records.filter((record) => record.kind === "test");
      assert.equal(cases.length, 2, JSON.stringify(records));
      assert.ok(cases.some((record) => record.status === "passed"));
      assert.ok(cases.some((record) => record.status === "failed"));
      for (const record of cases) {
        assert.ok(record.start >= start && record.start <= end, JSON.stringify(record));
        assert.ok(record.duration >= 0 && record.start + record.duration <= end + 10);
        assert.equal(record.file, "probe.test.mjs");
      }
      assert.ok(records.some((record) => record.kind === "end"));
      const expected = records.filter((record) => record.kind === "expected");
      assert.equal(expected.length, 1);
      assert.ok(records.every((record) => record.invocation === expected[0].invocation));
      const file = records.find((record) => record.kind === "file");
      assert.ok(file, JSON.stringify(records));
      for (const record of cases) assert.equal(record.parent, file.id);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
