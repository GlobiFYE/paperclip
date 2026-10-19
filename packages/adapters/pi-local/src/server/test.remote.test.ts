import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedAdapterExecutionTargetRuntime } from "@paperclipai/adapter-utils/execution-target";

const {
  prepareAdapterExecutionTargetRuntime,
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
  runtimeAssetDir,
  stagedModelsSnapshots,
} = vi.hoisted(() => {
  const restoreWorkspace = vi.fn(async () => undefined);
  const remoteAgentConfigDir = "/remote/workspace/.paperclip-runtime/pi/agentConfig";
  // Snapshot the staged models.json content at staging time: the real
  // preparePiRuntimeConfig temp dir is deleted by cleanup before assertions
  // run, so capture the bytes when the "upload" happens.
  const stagedModelsSnapshots: unknown[] = [];
  const prepare = vi.fn(async (input: { assets?: { key: string; localDir: string }[] }) => {
    for (const asset of input.assets ?? []) {
      if (asset.key !== "agentConfig") continue;
      stagedModelsSnapshots.push(
        JSON.parse(readFileSync(path.join(asset.localDir, "models.json"), "utf8")),
      );
    }
    const prepared: PreparedAdapterExecutionTargetRuntime = {
      target: { kind: "local" },
      workspaceRemoteDir: null,
      runtimeRootDir: null,
      assetDirs: { agentConfig: remoteAgentConfigDir },
      additionalSourceDirs: {},
      additionalSourceFailures: [],
      workspaceSyncSnapshot: null,
      restoreWorkspace,
    };
    return prepared;
  });
  return {
    prepareAdapterExecutionTargetRuntime: prepare,
    ensureAdapterExecutionTargetDirectory: vi.fn(async () => undefined),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
    maybeRunSandboxInstallCommand: vi.fn(async () => null),
    runAdapterExecutionTargetProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({
        type: "turn_end",
        message: { role: "assistant", content: "hello from the sandbox" },
      }),
      stderr: "",
    })),
    describeAdapterExecutionTarget: vi.fn(() => "env:fixture"),
    resolveAdapterExecutionTargetCwd: vi.fn(
      (_target: unknown, _configCwd: string, _fallback: string) => "/remote/workspace",
    ),
    runtimeAssetDir: vi.fn(
      (
        prepared: Pick<PreparedAdapterExecutionTargetRuntime, "assetDirs">,
        key: string,
        fallbackRemoteCwd: string,
      ) => prepared.assetDirs[key] ?? path.posix.join(fallbackRemoteCwd, ".paperclip-runtime", key),
    ),
    stagedModelsSnapshots,
  };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    prepareAdapterExecutionTargetRuntime,
    ensureAdapterExecutionTargetDirectory,
    ensureAdapterExecutionTargetCommandResolvable,
    maybeRunSandboxInstallCommand,
    runAdapterExecutionTargetProcess,
    describeAdapterExecutionTarget,
    resolveAdapterExecutionTargetCwd,
    runtimeAssetDir,
  };
});

vi.mock("./models.js", async () => {
  const actual = await vi.importActual<typeof import("./models.js")>("./models.js");
  return {
    ...actual,
    discoverPiModelsCached: vi.fn(async () => []),
  };
});

import { testEnvironment } from "./test.js";
import type { AdapterSshExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import type { AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";

const REMOTE_AGENT_CONFIG_DIR = "/remote/workspace/.paperclip-runtime/pi/agentConfig";

const remoteTarget: AdapterSshExecutionTarget = {
  kind: "remote",
  transport: "ssh",
  environmentId: null,
  leaseId: null,
  remoteCwd: "/remote/workspace",
  spec: {
    host: "127.0.0.1",
    port: 2222,
    username: "fixture",
    remoteWorkspacePath: "/remote/workspace",
    remoteCwd: "/remote/workspace",
    privateKey: "PRIVATE KEY",
    knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
    strictHostKeyChecking: true,
  },
};

function buildCtx(config: Record<string, unknown>): AdapterEnvironmentTestContext {
  return {
    companyId: "company-1",
    adapterType: "pi_local",
    config,
    executionTarget: remoteTarget,
    environmentName: "fixture-env",
  };
}

const PROVIDERS = {
  tensorix: {
    baseUrl: "http://gateway.example.svc.cluster.local:8080/anthropic",
    apiKey: "{env:ANTHROPIC_API_KEY}",
    api: "anthropic-messages",
    models: [{ id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek v3.1" }],
  },
};

describe("pi environment test (remote target)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ships the managed agent config to the target and repoints PI_CODING_AGENT_DIR when PAPERCLIP_PI_PROVIDERS is set", async () => {
    const result = await testEnvironment(
      buildCtx({
        command: "pi",
        model: "tensorix/deepseek/deepseek-chat-v3.1",
        env: {
          PAPERCLIP_PI_PROVIDERS: JSON.stringify(PROVIDERS),
          ANTHROPIC_API_KEY: "sk-bf-REALVK",
        },
      }),
    );

    // The managed dir (built by preparePiRuntimeConfig) is staged as the
    // agentConfig asset, not the local tmp path left in the env.
    expect(prepareAdapterExecutionTargetRuntime).toHaveBeenCalledTimes(1);
    const prepareInput = prepareAdapterExecutionTargetRuntime.mock.calls[0]?.[0] as
      | {
          syncWorkspace?: boolean;
          assets?: { key: string; localDir: string }[];
        }
      | undefined;
    expect(prepareInput?.syncWorkspace).toBe(false);
    const agentConfigAsset = prepareInput?.assets?.find((asset) => asset.key === "agentConfig");
    expect(agentConfigAsset?.localDir).toBeTruthy();
    const stagedModels = stagedModelsSnapshots[0] as
      | { providers?: Record<string, { baseUrl?: string }> }
      | undefined;
    expect(stagedModels?.providers?.tensorix?.baseUrl).toBe(
      "http://gateway.example.svc.cluster.local:8080/anthropic",
    );

    // The probe env is repointed at the in-sandbox copy of the config.
    const probeCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as
      | [string, unknown, string, string[], { env: Record<string, string> }]
      | undefined;
    expect(probeCall?.[4].env.PI_CODING_AGENT_DIR).toBe(REMOTE_AGENT_CONFIG_DIR);
    expect(probeCall?.[4].env.PAPERCLIP_PI_PROVIDERS).toBeTruthy();

    // The hello probe runs in the sandbox and passes with the shipped config.
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("pass");
    expect(result.checks.some((check) => check.code === "pi_hello_probe_passed")).toBe(true);
  });

  it("does not stage a runtime when PAPERCLIP_PI_PROVIDERS is unset", async () => {
    const prior = process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    try {
      const result = await testEnvironment(
        buildCtx({
          command: "pi",
          model: "openai/gpt-5.4-mini",
        }),
      );

      expect(prepareAdapterExecutionTargetRuntime).not.toHaveBeenCalled();
      const probeCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as
        | [string, unknown, string, string[], { env: Record<string, string> }]
        | undefined;
      expect(probeCall?.[4].env.PI_CODING_AGENT_DIR).toBeUndefined();
      expect(result.status).toBe("pass");
    } finally {
      if (prior !== undefined) process.env.PI_CODING_AGENT_DIR = prior;
    }
  });
});
