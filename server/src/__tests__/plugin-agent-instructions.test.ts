import { describe, expect, it, vi, beforeEach } from "vitest";
const store = vi.hoisted(() => ({ locked: vi.fn(), write: vi.fn(), inspect: vi.fn() }));
vi.mock("../services/agent-file-store.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/agent-file-store.js")>(),
  agentFileStore: () => store,
  inspectAgentFile: store.inspect,
}));
import { instructionActionActor, pluginAgentInstructions } from "../services/plugin-agent-instructions.js";

const context = { invocationScope: { companyId: "company", actionUserId: "user" } };
const input = { companyId: "company", agentId: "agent", path: "AGENTS.md" };
describe("plugin instruction action boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([undefined, {}, { invocationScope: { companyId: "company" } },
    { invocationScope: { companyId: "other", actionUserId: "user" } },
    { ...context, invalidInvocationScope: true }])("rejects unbound, background and cross-company contexts", (ctx) => {
    expect(() => instructionActionActor("company", ctx)).toThrow("authenticated user action");
  });
  it("forwards the host actor to native authorization, not caller-supplied actor fields", async () => {
    store.write.mockResolvedValue({ contentHash: "a".repeat(64), changed: true });
    await pluginAgentInstructions({} as never).write({ ...input, content: "hello", baseHash: null, userId: "forged" } as never, context);
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from("hello"), baseHash: null }), { type: "board", userId: "user" });
  });
  it("does not swallow native permission or stale-hash rejection", async () => {
    store.write.mockRejectedValue(new Error("AGENT_FILE_CONFLICT"));
    await expect(pluginAgentInstructions({} as never).write({ ...input, content: "new", baseHash: "a".repeat(64) }, context)).rejects.toThrow("AGENT_FILE_CONFLICT");
  });
  it.each(["../secret", "/etc/passwd", ".paperclip-runtime/secret"])("rejects unsafe path %s", async (path) => {
    await expect(pluginAgentInstructions({} as never).write({ ...input, path, content: "new", baseHash: null }, context)).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });
  it("rejects oversized/binary content before write", async () => {
    for (const content of ["a\0b", "a".repeat(1024 * 1024 + 1)]) {
      await expect(pluginAgentInstructions({} as never).write({ ...input, content, baseHash: null }, context)).rejects.toThrow();
    }
    expect(store.write).not.toHaveBeenCalled();
  });
  it("reads only through native locked authorization and returns a bounded content/hash pair", async () => {
    store.locked.mockImplementation(async (_c, _a, _actor, _write, fn) => fn({}, {}, "managed-root"));
    store.inspect.mockResolvedValue({ bytes: Buffer.from("instructions"), hash: "b".repeat(64) });
    await expect(pluginAgentInstructions({} as never).read(input, context)).resolves.toEqual({ path: "AGENTS.md", content: "instructions", contentHash: "b".repeat(64) });
    expect(store.locked).toHaveBeenCalledWith("company", "agent", { type: "board", userId: "user" }, false, expect.any(Function));
    expect(store.inspect).toHaveBeenCalledWith("managed-root", "AGENTS.md", 1024 * 1024, true);
  });
});
