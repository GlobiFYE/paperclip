import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterEnvironmentTestContext, AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { executeWithLocalCodexCommand, testWithLocalCodexCommand } from "../adapters/codex-local-command.js";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), execute: vi.fn(), test: vi.fn() }));
vi.mock("../vendor/paperclip-runner/index.js", () => ({ resolveCodexCommand: mocks.resolve }));
vi.mock("@paperclipai/adapter-codex-local/server", () => ({ execute: mocks.execute, testEnvironment: mocks.test }));
afterEach(() => vi.resetAllMocks());

const context = {
  companyId: "fixture-company", adapterType: "codex_local",
  config: { engine: "cli", cwd: "/fixture", env: { PATH: "/fixture/bin" } },
};

describe.skipIf(process.platform === "win32")("server local Codex command selection", () => {
  it("uses the same installed runtime for the probe and execution without mutating saved config", async () => {
    mocks.resolve.mockReturnValue("/installed/codex.js");
    await testWithLocalCodexCommand(context);
    await executeWithLocalCodexCommand(context as unknown as AdapterExecutionContext);
    const resolved = { ...context, config: { ...context.config, command: "/installed/codex.js" } };
    expect(mocks.test).toHaveBeenCalledWith(resolved);
    expect(mocks.execute).toHaveBeenCalledWith(resolved);
    expect(mocks.resolve).toHaveBeenCalledWith(undefined, expect.objectContaining({ PATH: "/fixture/bin" }), "/fixture");
    expect(context.config).not.toHaveProperty("command");
  });

  it.each([
    { ...context, config: { engine: "acp" } },
    { ...context, config: {} },
    { ...context, config: { engine: "cli", command: "/custom/codex" } },
    { ...context, config: { engine: "cli", command: "codex" } },
    { ...context, executionTarget: { kind: "remote", transport: "sandbox", remoteCwd: "/remote" } },
  ])("preserves explicit commands and other execution lanes: %j", async (input) => {
    await testWithLocalCodexCommand(input as AdapterEnvironmentTestContext);
    await executeWithLocalCodexCommand(input as unknown as AdapterExecutionContext);
    expect(mocks.resolve.mock.calls.length).toBe(0);
    expect(mocks.test).toHaveBeenCalledWith(input);
    expect(mocks.execute).toHaveBeenCalledWith(input);
  });

  it("fails both entrypoints before provider work if dependency resolution fails", async () => {
    mocks.resolve.mockImplementation(() => { throw new Error("Broken dependency fixture"); });
    expect(await testWithLocalCodexCommand(context)).toMatchObject({ status: "fail", checks: [{ code: "codex_command_unresolvable" }] });
    expect(await executeWithLocalCodexCommand(context as unknown as AdapterExecutionContext)).toMatchObject({ exitCode: 1, errorCode: "codex_command_unresolvable" });
    expect(mocks.test).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("resolves PATH fallbacks relative to the actual execution workspace", async () => {
    mocks.resolve.mockReturnValue("/installed/codex.js");
    await executeWithLocalCodexCommand({ ...context, context: { paperclipWorkspace: { cwd: "/task/workspace" } } } as unknown as AdapterExecutionContext);
    expect(mocks.resolve.mock.calls[0]?.[2]).toBe("/task/workspace");
  });
});
