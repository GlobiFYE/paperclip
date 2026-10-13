import { prepareFixtureApi, type FixtureState } from "./api";
export function installPluginFixtures(
  state: FixtureState = "ready",
  empty = false,
) {
  let plugin = {
    id: "plugin-gap",
    pluginKey: "storybook.fixture",
    packageName: "@paperclipai/storybook-fixture",
    version: "1.0.0",
    status: "ready",
    categories: ["automation"],
    manifestJson: {
      displayName: "Preview plugin",
      version: "1.0.0",
      description: "An isolated plugin fixture.",
      capabilities: [],
      instanceConfigSchema: {
        type: "object",
        properties: { label: { type: "string", title: "Label" } },
        required: ["label"],
      },
    },
    lastError: null as string | null,
    packagePath: null,
    createdAt: "2026-10-12T12:00:00Z",
    updatedAt: "2026-10-12T12:00:00Z",
  };
  let rows = empty ? [] : [plugin];
  let configJson: Record<string, unknown> = { label: "Release preview" };
  const health = {
    pluginId: plugin.id,
    status: "ready",
    healthy: true,
    checks: [],
  };
  return prepareFixtureApi(
    [
      { path: "/api/plugins", read: () => rows },
      { path: "/api/plugins/examples", read: () => [] },
      { path: "/api/plugins/ui-contributions", read: () => [] },
      {
        path: "/api/plugins/install",
        method: "POST",
        read: () => {
          rows = [plugin];
          return plugin;
        },
      },
      {
        path: "/api/plugins/plugin-gap",
        read: ({ method }) => {
          if (method === "DELETE") {
            rows = [];
            return { ok: true };
          }
          return plugin;
        },
      },
      {
        path: /^\/api\/plugins\/plugin-gap\/(enable|disable)$/,
        method: "POST",
        read: ({ url }) => {
          plugin = {
            ...plugin,
            status: url.pathname.endsWith("disable") ? "disabled" : "ready",
            lastError: url.pathname.endsWith("disable")
              ? "Disabled by operator"
              : null,
          };
          rows = [plugin];
          return { ok: true };
        },
      },
      { path: "/api/plugins/plugin-gap/health", read: () => health },
      { path: "/api/plugins/plugin-gap/logs", read: () => [] },
      {
        path: "/api/plugins/plugin-gap/dashboard",
        read: () => ({
          pluginId: plugin.id,
          worker: null,
          recentJobRuns: [],
          recentWebhookDeliveries: [],
          health,
          checkedAt: "2026-10-12T12:00:00Z",
        }),
      },
      {
        path: "/api/plugins/plugin-gap/config",
        read: ({ method, body }) => {
          if (method === "POST")
            configJson = body.configJson as Record<string, unknown>;
          return {
            id: "config-gap",
            pluginId: plugin.id,
            companyId: "company-storybook",
            configJson,
          };
        },
      },
      {
        path: "/api/plugins/plugin-gap/config/test",
        method: "POST",
        read: () => ({ valid: true }),
      },
    ],
    state,
  ).cleanup;
}
