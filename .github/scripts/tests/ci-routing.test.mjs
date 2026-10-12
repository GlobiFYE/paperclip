import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../workflows/ci-routing.yml", import.meta.url), "utf8");
const jobs = workflow.split(/^jobs:\n/m)[1];

test("routing uses reserved capacity and runs no PR code or actions", () => {
  assert.deepEqual([...jobs.matchAll(/^ {2}([a-z_]+):$/gm)].map((match) => match[1]), ["gate"]);
  assert.match(jobs, /^ {4}runs-on: runs-on\/fleet=paperclip-ci-routing-x64\/env=public-ci$/m);
  assert.doesNotMatch(jobs, /uses:|actions\/checkout|secrets\./);
  assert.doesNotMatch(workflow, /^ {2}(?:actions|contents|pull-requests): write$/m);
});

test("routing exports both placement and stack scope to callers", () => {
  assert.match(workflow, /^ {6}runner:\n {8}value: \$\{\{ jobs\.gate\.outputs\.runner \}\}$/m);
  assert.match(workflow, /^ {6}full_ci:\n {8}value: \$\{\{ jobs\.gate\.outputs\.full_ci \}\}$/m);
  assert.match(jobs, /^ {6}runner: \$\{\{ steps\.route\.outputs\.runner \}\}$/m);
  assert.match(jobs, /^ {6}full_ci: \$\{\{ steps\.scope\.outputs\.full_ci \}\}$/m);
});
