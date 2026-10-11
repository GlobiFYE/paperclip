import { describe, expect, it } from "vitest";
import { AGENT_FILES_CONTRACT } from "../services/agent-file-store.js";
import { instructionCopyContext } from "../services/agent-instruction-working-copies.js";

describe("instructionCopyContext", () => {
  it("describes a legacy instructions bundle", () => {
    expect(instructionCopyContext({ executionRoot: "/r/ws/.paperclip-runtime/instruction-edits-1/instructions", entryFile: "AGENTS.md", receipt: null }))
      .toEqual({ executionRoot: "/r/ws/.paperclip-runtime/instruction-edits-1/instructions", entryFile: "AGENTS.md", kind: "instructions_bundle" });
  });
  it("describes an agent directory copy", () => {
    expect(instructionCopyContext({ executionRoot: "/r/agent-files/a/o", entryFile: "AGENTS.md", receipt: { schema: AGENT_FILES_CONTRACT } as never }))
      .toEqual({ executionRoot: "/r/agent-files/a/o", entryFile: "AGENTS.md", kind: "agent_directory" });
  });
});
