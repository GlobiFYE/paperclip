import { describe, expect, it } from "vitest";
import { copilotLocalUIAdapter } from "./index";
import { getUIAdapter } from "../registry";

describe("copilotLocalUIAdapter", () => {
  it("is registered and exposes the copilot_local type", () => {
    expect(copilotLocalUIAdapter.type).toBe("copilot_local");
    expect(getUIAdapter("copilot_local").type).toBe("copilot_local");
  });

  it("parses an assistant.message line into an assistant transcript entry", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const entries = copilotLocalUIAdapter.parseStdoutLine(
      JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "Hello" } }),
      ts,
    );
    expect(entries.some((entry) => entry.kind === "assistant" && entry.text.includes("Hello"))).toBe(true);
  });
});
