import { afterEach, describe, expect, it, vi } from "vitest";
import { taskBudgetMeteringSupport } from "../services/task-budget-metering.js";

afterEach(() => vi.unstubAllEnvs());

describe("authoritative task budget metering", () => {
  it("distinguishes Codex API tokens from authoritative dollar receipts", () => {
    expect(taskBudgetMeteringSupport("codex_local", { config: { env: { OPENAI_API_KEY: "fixture" } } }))
      .toMatchObject({ billedCents: "unsupported", totalTokens: "reported" });
  });
  it("recognizes included local subscription billing and Claude API receipts", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(taskBudgetMeteringSupport("codex_local", { config: {} })).toMatchObject({ billedCents: "included_zero" });
    expect(taskBudgetMeteringSupport("claude_local", { config: { env: { ANTHROPIC_API_KEY: "fixture" } } }))
      .toMatchObject({ billedCents: "reported", totalTokens: "reported" });
  });
  it("denies unqualified providers and adapters", () => {
    expect(taskBudgetMeteringSupport("process", { config: {} })).toMatchObject({ totalTokens: "unsupported" });
    expect(taskBudgetMeteringSupport("claude_local", { config: {} }, "aws_agentcore"))
      .toMatchObject({ billedCents: "unsupported", totalTokens: "unsupported" });
  });
  it("keeps ambient native authentication unclassified for dollar caps", () => {
    expect(taskBudgetMeteringSupport("paperclip_runner", { config: { provider: "codex" } }))
      .toMatchObject({ billedCents: "unsupported", totalTokens: "reported" });
    expect(taskBudgetMeteringSupport("paperclip_runner", { config: { provider: "acpx", acpxAgent: "claude" } }))
      .toMatchObject({ billedCents: "unsupported", totalTokens: "reported" });
  });

});
