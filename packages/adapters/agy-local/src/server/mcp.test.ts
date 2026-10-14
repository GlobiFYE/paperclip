import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import {
  resolveAgyMcpConfigPath,
  resolveUniqueMcpServerName,
  writePaperclipAgyMcpConfig,
} from "./mcp.js";

describe("resolveAgyMcpConfigPath", () => {
  it("resolves to ~/.gemini/config/mcp_config.json based on homedir", () => {
    const configPath = resolveAgyMcpConfigPath("/custom/home", {});
    expect(configPath).toBe(path.join("/custom/home", ".gemini", "config", "mcp_config.json"));
  });

  it("prefers env.HOME when present", () => {
    const configPath = resolveAgyMcpConfigPath("/fallback/home", { HOME: "/env/home" });
    expect(configPath).toBe(path.join("/env/home", ".gemini", "config", "mcp_config.json"));
  });
});

describe("resolveUniqueMcpServerName", () => {
  it("uses server.name when there is no conflict", () => {
    const server: AdapterRuntimeMcpServer = {
      name: "Paperclip connections",
      url: "https://example.com/mcp",
      token: "secret",
      connectionId: "conn-12345678",
    };
    expect(resolveUniqueMcpServerName(server, new Set())).toBe("Paperclip connections");
  });

  it("appends connectionId slice on conflict", () => {
    const server: AdapterRuntimeMcpServer = {
      name: "github",
      url: "https://example.com/mcp",
      token: "secret",
      connectionId: "conn-12345678",
    };
    const existing = new Set(["github"]);
    expect(resolveUniqueMcpServerName(server, existing)).toBe("github-conn-123");
  });

  it("appends incremental counter on multiple collisions", () => {
    const server: AdapterRuntimeMcpServer = {
      name: "github",
      url: "https://example.com/mcp",
      token: "secret",
      connectionId: "conn-12345678",
    };
    const existing = new Set(["github", "github-conn-123"]);
    expect(resolveUniqueMcpServerName(server, existing)).toBe("github-conn-123-2");
  });
});

describe("writePaperclipAgyMcpConfig", () => {
  it("creates mcp_config.json and cleans up when no prior file existed", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    const servers: AdapterRuntimeMcpServer[] = [
      {
        name: "Paperclip connections",
        url: "https://api.paperclip.test/mcp/connections",
        token: "tok-abc",
        connectionId: "conn-1",
      },
      {
        name: "Paperclip projects",
        url: "https://api.paperclip.test/mcp/projects",
        token: "",
        connectionId: "conn-2",
      },
    ];

    try {
      const result = await writePaperclipAgyMcpConfig({
        homedir: tempDir,
        servers,
        runId: "run-1",
      });

      expect(result.injectedServerNames).toEqual(["Paperclip connections", "Paperclip projects"]);
      expect(result.configPath).toBe(path.join(tempDir, ".gemini", "config", "mcp_config.json"));

      const content = JSON.parse(await fs.readFile(result.configPath, "utf8"));
      expect(content.mcpServers["Paperclip connections"]).toEqual({
        url: "https://api.paperclip.test/mcp/connections",
        headers: { Authorization: "Bearer tok-abc" },
      });
      expect(content.mcpServers["Paperclip projects"]).toEqual({
        url: "https://api.paperclip.test/mcp/projects",
      });

      await result.cleanup();

      // Since file was created from scratch and now empty, it should be deleted
      const exists = await fs.stat(result.configPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("preserves unmanaged user MCP servers before, during, and after cleanup", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    const configDir = path.join(tempDir, ".gemini", "config");
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "mcp_config.json");

    const initialConfig = {
      mcpServers: {
        codegraph: {
          command: "codegraph",
          args: ["serve", "--mcp"],
        },
        custom_http: {
          url: "https://custom.tool/mcp",
        },
      },
      otherSettings: { enabled: true },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), "utf8");

    const servers: AdapterRuntimeMcpServer[] = [
      {
        name: "codegraph",
        url: "https://api.paperclip.test/mcp/gateways/codegraph",
        token: "gw-token",
        connectionId: "cg-conn-12345",
      },
    ];

    try {
      const result = await writePaperclipAgyMcpConfig({
        homedir: tempDir,
        servers,
      });

      // Avoided collision with pre-existing "codegraph"
      expect(result.injectedServerNames).toEqual(["codegraph-cg-conn-"]);

      const content = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(content.mcpServers.codegraph).toEqual(initialConfig.mcpServers.codegraph);
      expect(content.mcpServers.custom_http).toEqual(initialConfig.mcpServers.custom_http);
      expect(content.mcpServers["codegraph-cg-conn-"]).toEqual({
        url: "https://api.paperclip.test/mcp/gateways/codegraph",
        headers: { Authorization: "Bearer gw-token" },
      });
      expect(content.otherSettings).toEqual({ enabled: true });

      await result.cleanup();

      const afterCleanup = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(afterCleanup.mcpServers.codegraph).toEqual(initialConfig.mcpServers.codegraph);
      expect(afterCleanup.mcpServers.custom_http).toEqual(initialConfig.mcpServers.custom_http);
      expect(afterCleanup.mcpServers["codegraph-cg-conn-"]).toBeUndefined();
      expect(afterCleanup.otherSettings).toEqual({ enabled: true });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("refuses to overwrite an unparseable existing config", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    const configDir = path.join(tempDir, ".gemini", "config");
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "mcp_config.json");
    await fs.writeFile(configPath, "{ not json", "utf8");

    try {
      await expect(
        writePaperclipAgyMcpConfig({
          homedir: tempDir,
          servers: [{ name: "Paperclip connections", url: "https://api.paperclip.test/mcp", token: "", connectionId: "c1" }],
        }),
      ).rejects.toThrow(/not valid JSON/);

      // The user's file is left byte-for-byte untouched.
      expect(await fs.readFile(configPath, "utf8")).toBe("{ not json");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("refuses to overwrite an existing config whose root is not an object", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    const configDir = path.join(tempDir, ".gemini", "config");
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "mcp_config.json");
    await fs.writeFile(configPath, "[1, 2, 3]\n", "utf8");

    try {
      await expect(
        writePaperclipAgyMcpConfig({
          homedir: tempDir,
          servers: [{ name: "Paperclip connections", url: "https://api.paperclip.test/mcp", token: "", connectionId: "c1" }],
        }),
      ).rejects.toThrow(/not a JSON object/);

      expect(await fs.readFile(configPath, "utf8")).toBe("[1, 2, 3]\n");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("sweeps stale injected entries from earlier runs before injecting", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    const configDir = path.join(tempDir, ".gemini", "config");
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "mcp_config.json");

    // Leftovers from a hard-killed run (stale token, dead suffixed variant),
    // alongside a user server that shares the "Paperclip" prefix by name only
    // in value shape — it has command/args, so it is not an injected entry.
    const initialConfig = {
      mcpServers: {
        "Paperclip connections": {
          url: "https://api.paperclip.test/mcp/connections",
          headers: { Authorization: "Bearer stale-token" },
        },
        "Paperclip projects-conn-999": {
          url: "https://api.paperclip.test/mcp/projects",
          headers: { Authorization: "Bearer older-token" },
        },
        "Paperclip projects": {
          command: "my-own-projects-server",
          args: ["serve"],
        },
        custom_http: {
          url: "https://custom.tool/mcp",
        },
      },
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), "utf8");

    try {
      const result = await writePaperclipAgyMcpConfig({
        homedir: tempDir,
        servers: [
          {
            name: "Paperclip connections",
            url: "https://api.paperclip.test/mcp/connections",
            token: "fresh-token",
            connectionId: "conn-1",
          },
          {
            name: "Paperclip projects",
            url: "https://api.paperclip.test/mcp/projects",
            token: "fresh-token",
            connectionId: "conn-2",
          },
        ],
      });

      expect(result.sweptStaleServerNames).toEqual(
        expect.arrayContaining(["Paperclip connections", "Paperclip projects-conn-999"]),
      );
      expect(result.sweptStaleServerNames).not.toContain("Paperclip projects");

      const content = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(content.mcpServers["Paperclip connections"]).toEqual({
        url: "https://api.paperclip.test/mcp/connections",
        headers: { Authorization: "Bearer fresh-token" },
      });
      // The user's own "Paperclip projects" (command-shaped) survives, so the
      // managed one lands on its connection-suffixed name.
      expect(content.mcpServers["Paperclip projects"]).toEqual(initialConfig.mcpServers["Paperclip projects"]);
      expect(content.mcpServers["Paperclip projects-conn-2"]).toEqual({
        url: "https://api.paperclip.test/mcp/projects",
        headers: { Authorization: "Bearer fresh-token" },
      });
      expect(content.mcpServers["Paperclip projects-conn-999"]).toBeUndefined();
      expect(content.mcpServers.custom_http).toEqual(initialConfig.mcpServers.custom_http);

      await result.cleanup();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("serializes concurrent writes so neither run's servers are lost", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));

    try {
      const [a, b] = await Promise.all([
        writePaperclipAgyMcpConfig({
          homedir: tempDir,
          servers: [{ name: "Paperclip connections", url: "https://a.test/mcp", token: "tok-a", connectionId: "ca" }],
          runId: "run-a",
        }),
        writePaperclipAgyMcpConfig({
          homedir: tempDir,
          servers: [{ name: "Paperclip projects", url: "https://b.test/mcp", token: "tok-b", connectionId: "cb" }],
          runId: "run-b",
        }),
      ]);

      const content = JSON.parse(await fs.readFile(a.configPath, "utf8"));
      expect(content.mcpServers["Paperclip connections"]).toEqual({
        url: "https://a.test/mcp",
        headers: { Authorization: "Bearer tok-a" },
      });
      expect(content.mcpServers["Paperclip projects"]).toEqual({
        url: "https://b.test/mcp",
        headers: { Authorization: "Bearer tok-b" },
      });

      await a.cleanup();
      await b.cleanup();

      const exists = await fs.stat(a.configPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("cleanup leaves a same-named entry that a later run re-injected with a fresher token", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));

    try {
      const first = await writePaperclipAgyMcpConfig({
        homedir: tempDir,
        servers: [{ name: "Paperclip connections", url: "https://api.paperclip.test/mcp", token: "tok-old", connectionId: "c1" }],
        runId: "run-old",
      });
      const second = await writePaperclipAgyMcpConfig({
        homedir: tempDir,
        servers: [{ name: "Paperclip connections", url: "https://api.paperclip.test/mcp", token: "tok-new", connectionId: "c1" }],
        runId: "run-new",
      });

      // The first run's cleanup must not delete the second run's live entry.
      await first.cleanup();
      const afterFirstCleanup = JSON.parse(await fs.readFile(first.configPath, "utf8"));
      expect(afterFirstCleanup.mcpServers["Paperclip connections"]).toEqual({
        url: "https://api.paperclip.test/mcp",
        headers: { Authorization: "Bearer tok-new" },
      });

      await second.cleanup();
      const exists = await fs.stat(first.configPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
