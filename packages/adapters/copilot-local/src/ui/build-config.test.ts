import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildCopilotLocalConfig } from "./build-config.js";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "copilot_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: true,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 1000,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

describe("buildCopilotLocalConfig", () => {
  it("defaults the model to auto when unset", () => {
    const config = buildCopilotLocalConfig(makeValues());
    expect(config.model).toBe("auto");
    expect(config.timeoutSec).toBe(0);
    expect(config.graceSec).toBe(15);
    expect(config).not.toHaveProperty("effort");
  });

  it("persists an explicit model, effort and command", () => {
    const config = buildCopilotLocalConfig(makeValues({
      model: "gpt-5.4",
      thinkingEffort: "high",
      command: "/usr/local/bin/copilot",
    }));
    expect(config.model).toBe("gpt-5.4");
    expect(config.effort).toBe("high");
    expect(config.command).toBe("/usr/local/bin/copilot");
  });

  it("persists cwd, instructionsFilePath, and extra args", () => {
    const config = buildCopilotLocalConfig(makeValues({
      cwd: "/tmp/project",
      instructionsFilePath: "/tmp/project/AGENTS.md",
      extraArgs: "--add-dir /tmp/other, --experimental",
    }));
    expect(config.cwd).toBe("/tmp/project");
    expect(config.instructionsFilePath).toBe("/tmp/project/AGENTS.md");
    expect(config.extraArgs).toEqual(["--add-dir /tmp/other", "--experimental"]);
  });

  it("merges legacy env vars with secret bindings", () => {
    const config = buildCopilotLocalConfig(makeValues({
      envVars: "COPILOT_HOME=/tmp/copilot\n# comment\nINVALID LINE",
      envBindings: {
        COPILOT_GITHUB_TOKEN: { type: "secret_ref", secretId: "secret-1" },
      },
    }));
    expect(config.env).toEqual({
      COPILOT_HOME: { type: "plain", value: "/tmp/copilot" },
      COPILOT_GITHUB_TOKEN: { type: "secret_ref", secretId: "secret-1" },
    });
  });
});
