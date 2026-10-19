// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiConnectionBinding, AiManagedConnectionSummary } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { agentsApi } from "@/api/agents";
import { useConnectionModels } from "./useConnectionModels";

vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: vi.fn() } }));
vi.mock("@/api/agents", () => ({ agentsApi: { adapterModels: vi.fn() } }));

const binding: AiConnectionBinding = { provider: "openrouter", method: "api_key", mode: "shared", connectionId: "router", grantId: "grant" };
const account: AiManagedConnectionSummary = {
  id: "router", grantId: "grant", companyId: "company", provider: "openrouter", method: "api_key",
  name: "Company OpenRouter", ownership: "shared", isDefault: false, status: "connected",
  routing: { kind: "openrouter", protocol: "chat", auth: "bearer", models: [] },
};
const catalog = [
  { id: "openrouter/z-ai/glm-5", label: "Z.AI GLM" },
  { id: "openrouter/anthropic/claude-sonnet-4.5", label: "Claude Sonnet" },
  { id: "openrouter/openrouter/auto", label: "Auto Router" },
];
let root: Root;
let client: QueryClient;
let result: ReturnType<typeof useConnectionModels>;
let render: (value: AiConnectionBinding | undefined) => Promise<void>;

beforeEach(() => {
  vi.mocked(agentsApi.adapterModels).mockResolvedValue(catalog);
  vi.mocked(aiConnectionsApi.list).mockResolvedValue({ currentUserId: "you", connections: [account], canManageConnections: true });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});

async function mount(accounts: AiManagedConnectionSummary[] = [account], harness = "opencode_local", value: AiConnectionBinding | undefined = binding) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["ai-connections", "company"], { currentUserId: "you", connections: accounts });
  root = createRoot(document.createElement("div"));
  function Probe({ value }: { value: AiConnectionBinding | undefined }) {
    result = useConnectionModels("company", value, harness);
    return null;
  }
  render = async next => { await act(async () => root.render(<QueryClientProvider client={client}><Probe value={next} /></QueryClientProvider>)); };
  await render(value);
}

it.each(["opencode_local", "codex_local", "claude_local", "hermes_local"])("automatically discovers an empty OpenRouter connection's models for %s", async harness => {
  await mount([account], harness);
  await vi.waitFor(() => expect(result?.models).toHaveLength(3));
  expect(agentsApi.adapterModels).toHaveBeenCalledWith("company", "opencode_local", { provider: "openrouter" });
  expect(result?.models.map(m => m.id)).toEqual(catalog.map(m => harness === "opencode_local" ? m.id : m.id.slice("openrouter/".length)));
  expect(result?.models.map(m => m.label)).toEqual(catalog.map(m => m.label));
  expect(result?.resolveModel("anthropic/custom-model")).toBe(harness === "opencode_local" ? "openrouter/anthropic/custom-model" : "anthropic/custom-model");
});

it("also discovers models for legacy OpenRouter connections without routing metadata", async () => {
  await mount([{ ...account, routing: undefined }]);
  await vi.waitFor(() => expect(result?.models).toEqual(catalog));
});

it("preserves an explicit connection model list instead of replacing it with the public catalog", async () => {
  await mount([{ ...account, routing: { ...account.routing!, models: [{ id: "company/model", label: "Approved model" }] } }]);
  expect(result?.models).toEqual([{ id: "openrouter/company/model", label: "Approved model" }]);
  expect(agentsApi.adapterModels).not.toHaveBeenCalled();
});

it("merges on-disk catalog efforts onto a claude_local connection pool's model list", async () => {
  const claudeCatalogModels = [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", efforts: ["low", "medium", "high", "xhigh"] },
  ];
  vi.mocked(agentsApi.adapterModels).mockImplementation((_companyId, type) =>
    Promise.resolve(type === "claude_local" ? claudeCatalogModels : catalog));
  const pool: AiManagedConnectionSummary = {
    ...account,
    id: "claude-pool",
    grantId: "claude-grant",
    provider: "anthropic",
    routing: { kind: "bedrock", protocol: "bedrock", auth: "bearer", region: "us-east-1", models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }] },
  };
  await mount([pool], "claude_local", { provider: "anthropic", method: "api_key", mode: "shared", connectionId: pool.id, grantId: pool.grantId });
  await vi.waitFor(() => expect(result?.models).toEqual([{ id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: ["low", "medium", "high", "xhigh"] }]));
  expect(agentsApi.adapterModels).toHaveBeenCalledWith("company", "claude_local");
});

it("leaves a claude_local pool model's options untouched when the catalog has no matching id", async () => {
  vi.mocked(agentsApi.adapterModels).mockImplementation((_companyId, type) =>
    Promise.resolve(type === "claude_local" ? [] : catalog));
  const pool: AiManagedConnectionSummary = {
    ...account,
    id: "claude-pool",
    grantId: "claude-grant",
    provider: "anthropic",
    routing: { kind: "bedrock", protocol: "bedrock", auth: "bearer", region: "us-east-1", models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }] },
  };
  await mount([pool], "claude_local", { provider: "anthropic", method: "api_key", mode: "shared", connectionId: pool.id, grantId: pool.grantId });
  await vi.waitFor(() => expect(result?.models).toEqual([{ id: "claude-haiku-4-5", label: "Haiku 4.5" }]));
});

it("surfaces a claude_local catalog failure instead of silently falling back, and allows retry", async () => {
  const claudeCatalogModels = [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", efforts: ["low", "medium", "high", "xhigh"] },
  ];
  let reject!: (error: Error) => void;
  vi.mocked(agentsApi.adapterModels).mockImplementation((_companyId, type) =>
    type === "claude_local"
      ? new Promise((_, rejectPromise) => { reject = rejectPromise; })
      : Promise.resolve(catalog));
  const pool: AiManagedConnectionSummary = {
    ...account,
    id: "claude-pool",
    grantId: "claude-grant",
    provider: "anthropic",
    routing: { kind: "bedrock", protocol: "bedrock", auth: "bearer", region: "us-east-1", models: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }] },
  };
  await mount([pool], "claude_local", { provider: "anthropic", method: "api_key", mode: "shared", connectionId: pool.id, grantId: pool.grantId });
  await act(async () => reject(new Error("Catalog unavailable")));
  await vi.waitFor(() => expect(result?.error?.message).toBe("Catalog unavailable"));
  // The model list itself still comes from the pool's own allow-list, unaffected by the
  // optional-efforts lookup failing — only the error/refresh state needs to surface it.
  expect(result?.models).toEqual([{ id: "claude-haiku-4-5", label: "Haiku 4.5" }]);

  vi.mocked(agentsApi.adapterModels).mockImplementation((_companyId, type) =>
    Promise.resolve(type === "claude_local" ? claudeCatalogModels : catalog));
  await act(async () => { await result?.refreshModels?.(); });
  await vi.waitFor(() => expect(result?.error).toBeNull());
  expect(result?.models).toEqual([{ id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: ["low", "medium", "high", "xhigh"] }]);
});

it("does not reuse public OpenRouter models after switching to a custom gateway", async () => {
  const gateway: AiManagedConnectionSummary = { ...account, id: "gateway", grantId: "gateway-grant", provider: "openai", routing: { kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://example.com/v1", models: [] } };
  await mount([account, gateway]);
  await vi.waitFor(() => expect(result?.models).toEqual(catalog));
  await render({ provider: "openai", method: "api_key", mode: "shared", connectionId: gateway.id, grantId: gateway.grantId });
  expect(result?.models).toEqual([]);
  expect(result?.resolveModel("private-model")).toBe("paperclip/private-model");
  expect(result?.refreshModels).toBeUndefined();
});

it("leaves native model discovery alone", async () => {
  await mount([], "codex_local", { provider: "openai", method: "subscription", mode: "responsible_user" });
  expect(result).toBeUndefined();
  expect(agentsApi.adapterModels).not.toHaveBeenCalled();
});

it("only uses the current person's default connection models", async () => {
  await mount([
    { ...account, ownership: "personal", ownerUserId: "someone-else", isDefault: true, routing: { ...account.routing!, models: [{ id: "other/private-model" }] } },
    { ...account, ownership: "personal", ownerUserId: "you", isDefault: true },
  ], "opencode_local", { provider: "openrouter", method: "api_key", mode: "responsible_user" });
  await vi.waitFor(() => expect(result?.models).toEqual(catalog));
});

it("exposes loading and allows retry after a catalog failure", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(agentsApi.adapterModels).mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  await mount();
  expect(result?.isLoading).toBe(true);
  await act(async () => reject(new Error("Catalog unavailable")));
  await vi.waitFor(() => expect(result?.error?.message).toBe("Catalog unavailable"));
  expect(result?.isLoading).toBe(false);
  expect(result?.resolveModel("manual/model")).toBe("openrouter/manual/model");
  await act(async () => { await result?.refreshModels?.(); });
  await vi.waitFor(() => expect(result?.models).toEqual(catalog));
  expect(result?.error).toBeNull();
});
