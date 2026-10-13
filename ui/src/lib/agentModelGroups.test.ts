import { describe, expect, it } from "vitest";
import { agentModel, agentProvider, groupAgentsByModel } from "./agentModelGroups";

describe("agentModelGroups", () => {
  it("names providers from adapter type and hermes provider, never from env", () => {
    expect(agentProvider({ id: "1", adapterType: "hermes_local", adapterConfig: { provider: "xiaomi", model: "mimo-v2.6-pro", env: { XIAOMI_API_KEY: "x" } } })).toBe("MiMo");
    expect(agentProvider({ id: "2", adapterType: "grok_local", adapterConfig: { model: "grok-4.7" } })).toBe("Grok");
    expect(agentProvider({ id: "3", adapterType: "process", adapterConfig: {} })).toBe("Process (no model)");
    expect(agentProvider({ id: "4", adapterType: "hermes_local", adapterConfig: { provider: "zzz" } })).toBe("Hermes · zzz");
    expect(agentProvider({ id: "4b", adapterType: "hermes_local", adapterConfig: {} })).toBe("Hermes (default provider)");
    // paperclip_runner persists its provider id too.
    expect(agentProvider({ id: "9", adapterType: "paperclip_runner", adapterConfig: { provider: "claude_managed", model: "claude-opus-5-5" } })).toBe("Claude");
    expect(agentProvider({ id: "10", adapterType: "paperclip_runner", adapterConfig: { provider: "codex" } })).toBe("Codex");
    expect(agentProvider({ id: "11", adapterType: "paperclip_runner", adapterConfig: {} })).toBe("Paperclip runner (default provider)");
    expect(agentModel({ id: "3", adapterType: "process" })).toBe("—");
    expect(agentModel({ id: "5", adapterType: "claude_local", adapterConfig: {} })).toBe("default model");
    // Pi and OpenCode write provider/model: group by the AI provider, not the client.
    expect(agentProvider({ id: "6", adapterType: "pi_local", adapterConfig: { model: "anthropic/claude-sonnet-4" } })).toBe("Claude");
    expect(agentModel({ id: "6", adapterType: "pi_local", adapterConfig: { model: "anthropic/claude-sonnet-4" } })).toBe("claude-sonnet-4");
    expect(agentProvider({ id: "7", adapterType: "opencode_local", adapterConfig: { model: "openai/gpt-5" } })).toBe("OpenAI");
    expect(agentProvider({ id: "8", adapterType: "pi_local", adapterConfig: {} })).toBe("Pi (default provider)");
  });

  it("groups by provider then model, biggest groups first", () => {
    const groups = groupAgentsByModel([
      { id: "a", adapterType: "hermes_local", adapterConfig: { provider: "xiaomi", model: "mimo-v2.6-pro" } },
      { id: "b", adapterType: "hermes_local", adapterConfig: { provider: "xiaomi", model: "mimo-v2.6-flash" } },
      { id: "c", adapterType: "hermes_local", adapterConfig: { provider: "xiaomi", model: "mimo-v2.6-pro" } },
      { id: "d", adapterType: "hermes_local", adapterConfig: { provider: "minimax", model: "MiniMax-M2.7" } },
      { id: "e", adapterType: "grok_local", adapterConfig: { model: "grok-4.7" } },
    ]);
    expect(groups.map((g) => [g.provider, g.count])).toEqual([["MiMo", 3], ["Grok", 1], ["MiniMax", 1]]);
    expect(groups[0].models.map((m) => [m.model, m.agents.length])).toEqual([["mimo-v2.6-pro", 2], ["mimo-v2.6-flash", 1]]);
  });
});
