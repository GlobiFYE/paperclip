import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCopilotSkills,
  syncCopilotSkills,
} from "@paperclipai/adapter-copilot-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("copilot local skill sync", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("defaults and installs the operational Paperclip skill in the Copilot skills home", async () => {
    const copilotHome = await makeTempDir("paperclip-copilot-skill-sync-");
    cleanupDirs.add(copilotHome);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "copilot_local",
      config: {
        env: {
          COPILOT_HOME: copilotHome,
        },
      },
    } as const;

    const before = await listCopilotSkills(ctx);
    expect(before.adapterType).toBe("copilot_local");
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("missing");

    const after = await syncCopilotSkills(ctx, [paperclipKey]);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(copilotHome, "skills", "paperclip"))).isSymbolicLink()).toBe(true);
  });
});
