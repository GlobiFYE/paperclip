import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// PR processes write timing data only. They never receive a Honeycomb key.
export function recorder(framework) {
  const enabled = process.env.PAPERCLIP_CI_PROFILE === "true";
  const directory = process.env.PAPERCLIP_CI_PROFILE_DIR;
  const invocation = randomUUID();
  const file = directory && path.join(directory, `${framework}-${invocation}.ndjson`);
  let warned = false;
  return (record) => {
    if (!enabled || !file) return;
    try {
      mkdirSync(directory, { recursive: true });
      appendFileSync(file, JSON.stringify({
        version: 1,
        framework,
        invocation,
        job: process.env.PAPERCLIP_CI_PROFILE_JOB,
        runId: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        ...record,
      }) + "\n");
    } catch {
      // Profiling must not change a test's result. The exporter reports gaps.
      if (!warned) console.error("CI profile: unable to write test timing data");
      warned = true;
    }
  };
}

export function relativeFile(file) {
  return path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), file).replaceAll("\\", "/");
}
