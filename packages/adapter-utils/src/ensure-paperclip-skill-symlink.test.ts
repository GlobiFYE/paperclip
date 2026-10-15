import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensurePaperclipSkillSymlink } from "./server-utils.js";

describe("ensurePaperclipSkillSymlink", () => {
  let root: string;
  let target: string;

  const installSkill = (version: string, skill = "paperclip") =>
    path.join(root, "installs", "npm", version, "node_modules", "@paperclipai", "server", "skills", skill);

  async function makeSkill(dir: string) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Skill\n", "utf8");
  }

  async function linkedTarget() {
    return path.resolve(path.dirname(target), await fs.readlink(target));
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skill-link-"));
    target = path.join(root, "skills-home", "paperclip");
    await fs.mkdir(path.dirname(target), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("re-points a link that still resolves into a previous npm-managed install", async () => {
    const previous = installSkill("2026.1005.0");
    const source = installSkill("2026.1012.0");
    await makeSkill(previous);
    await makeSkill(source);
    await fs.symlink(previous, target);

    await expect(ensurePaperclipSkillSymlink(source, target)).resolves.toBe("repaired");
    expect(await linkedTarget()).toBe(source);
  });

  it("keeps a live link to a different packaged skill", async () => {
    const other = installSkill("2026.1012.0", "paperclip-create-agent");
    const source = installSkill("2026.1012.0");
    await makeSkill(other);
    await makeSkill(source);
    await fs.symlink(other, target);

    await expect(ensurePaperclipSkillSymlink(source, target)).resolves.toBe("skipped");
    expect(await linkedTarget()).toBe(other);
  });

  it("keeps a live link that points outside a Paperclip package", async () => {
    const external = path.join(root, "external-skills", "paperclip");
    const source = installSkill("2026.1012.0");
    await makeSkill(external);
    await makeSkill(source);
    await fs.symlink(external, target);

    await expect(ensurePaperclipSkillSymlink(source, target)).resolves.toBe("skipped");
    expect(await linkedTarget()).toBe(external);
  });

  it("still repairs a link whose target was removed", async () => {
    const source = installSkill("2026.1012.0");
    await makeSkill(source);
    await fs.symlink(path.join(root, "gone", "paperclip"), target);

    await expect(ensurePaperclipSkillSymlink(source, target)).resolves.toBe("repaired");
    expect(await linkedTarget()).toBe(source);
  });
});
