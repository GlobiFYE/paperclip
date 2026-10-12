import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { capabilities, fingerprint, renderIndex, validateCatalog } from "./storybook-catalog.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybook-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file, text) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  write("maps/feature-map/tasks.md", "# Tasks\n\n## Sub-features\n\n- `create`: create\n- `discussion`: discuss\n\n## How to get to it\n");
  write("ui/storybook/.storybook/preview.tsx", "// shared fixtures\n");
  const file = "ui/storybook/stories/task.stories.tsx";
  write(file, "// a story\n");
  write("ui/src/Task.tsx", "// production subject\n");
  const sharedSources = ["ui/storybook/.storybook/preview.tsx"];
  const sources = [file, "ui/src/Task.tsx"];
  const catalog = {
    version: 1, sharedReview: { sources: sharedSources, fingerprint: fingerprint(root, sharedSources) },
    entries: [{ file, capabilities: ["tasks/create", "tasks/discussion"], purpose: "Create a task", status: "current",
      implementation: "production", boundary: "fixtures", notes: "Production subject; callbacks simulated.",
      reviewedAt: "2026-10-12", sources, fingerprint: fingerprint(root, sources) }],
  };
  const stories = [{ file, title: "Tasks/Create", ids: ["tasks-create--empty"], plays: 0 }];
  return { root, write, file, catalog, stories };
}

test("complete inventory accepts production subjects with simulated data", t => {
  const f = fixture(t);
  assert.deepEqual(validateCatalog(f.root, f.catalog, f.stories), []);
});

test("adding, removing or duplicating story files requires reconciliation", t => {
  const f = fixture(t);
  assert.match(validateCatalog(f.root, { ...f.catalog, entries: [] }, f.stories).join("\n"), /missing from catalog/);
  assert.match(validateCatalog(f.root, f.catalog, []).join("\n"), /missing story file/);
  f.catalog.entries.push(f.catalog.entries[0]);
  assert.match(validateCatalog(f.root, f.catalog, f.stories).join("\n"), /duplicate catalog entry/);
});

test("capability renames and unjustified unmapped stories fail", t => {
  const f = fixture(t);
  f.catalog.entries[0].capabilities = ["tasks/old-name"];
  assert.match(validateCatalog(f.root, f.catalog, f.stories).join("\n"), /unknown feature capability/);
  f.catalog.entries[0].capabilities = [];
  assert.match(validateCatalog(f.root, f.catalog, f.stories).join("\n"), /explicit reason/);
  f.catalog.entries[0].exception = "Shared foundation";
  assert.deepEqual(validateCatalog(f.root, f.catalog, f.stories), []);
});

test("production and shared fixture drift invalidate review fingerprints", t => {
  const f = fixture(t);
  f.write("ui/src/Task.tsx", "// changed contract\n");
  f.write("ui/storybook/.storybook/preview.tsx", "// changed shared mocks\n");
  const errors = validateCatalog(f.root, f.catalog, f.stories);
  assert.equal(errors.filter(error => error.includes("source changed")).length, 2);
  assert.equal(f.catalog.entries[0].fingerprint.length, 64);
});

test("missing and escaping source references cannot certify a review", t => {
  const f = fixture(t);
  f.catalog.entries[0].sources.push("../outside.ts");
  assert.match(validateCatalog(f.root, f.catalog, f.stories).join("\n"), /invalid review sources/);
});

test("cross-capability lookup retains one canonical file and honest status", t => {
  const f = fixture(t);
  f.catalog.entries[0].status = "historical";
  const index = renderIndex(f.catalog, f.stories, capabilities(f.root));
  assert.match(index, /tasks\/create.*\(historical\)/);
  assert.match(index, /tasks\/discussion.*\(historical\)/);
  assert.match(index, /1 story files; 1 indexed stories/);
  assert.match(index, /historical \/ production \/ fixtures/);
});

test("duplicate story IDs cannot silently collapse distinct examples", t => {
  const f = fixture(t);
  f.stories[0].ids.push(f.stories[0].ids[0]);
  assert.match(validateCatalog(f.root, f.catalog, f.stories).join("\n"), /Duplicate story IDs/);
});
