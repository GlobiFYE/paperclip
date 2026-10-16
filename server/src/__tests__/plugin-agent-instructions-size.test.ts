import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { inspectAgentFile } from "../services/agent-file-store.js";

it("rejects oversized plugin text before creating a content stream", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-size-"));
  try {
    await fs.writeFile(path.join(root, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 65));
    await expect(inspectAgentFile(root, "large.txt", 1024 * 1024, true)).rejects.toMatchObject({ status: 422 });
    await fs.writeFile(path.join(root, "small.txt"), "small");
    expect((await inspectAgentFile(root, "small.txt", 1024 * 1024, true))?.bytes?.toString()).toBe("small");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
