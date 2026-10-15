import { describe, expect, it } from "vitest";
import { createAgentSchema, updateAgentSchema } from "./agent.js";

const base = {
  name: "CTO",
  role: "cto",
  adapterType: "codex_local",
} as const;

describe("atomic paused creation flag", () => {
  it("defaults initialPaused to false, preserving historical idle creation", () => {
    expect(createAgentSchema.parse({ ...base }).initialPaused).toBe(false);
  });

  it("accepts initialPaused true for opt-in paused creation", () => {
    const parsed = createAgentSchema.parse({ ...base, initialPaused: true });
    expect(parsed.initialPaused).toBe(true);
    expect(parsed.role).toBe("cto");
  });

  it("keeps cto legal while coo/cko remain rejected", () => {
    expect(createAgentSchema.safeParse({ ...base, role: "cto" }).success).toBe(
      true,
    );
    expect(
      createAgentSchema.safeParse({ ...base, role: "coo" }).success,
    ).toBe(false);
    expect(
      createAgentSchema.safeParse({ ...base, role: "cko" }).success,
    ).toBe(false);
  });

  it("does not leak initialPaused into update payloads", () => {
    const parsed = updateAgentSchema.parse({
      name: "CTO",
      initialPaused: true,
    });
    expect("initialPaused" in parsed).toBe(false);
  });
});
