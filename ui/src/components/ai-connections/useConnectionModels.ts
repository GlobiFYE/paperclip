import { useQuery } from "@tanstack/react-query";
import { aiRoutingModel, type AiConnectionBinding, type AiProviderRouting } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";

export function useConnectionModels(
  companyId: string | null | undefined,
  binding: AiConnectionBinding | undefined,
  harness: string,
) {
  const isClaudeLocal = harness === "claude_local";
  const accounts = useQuery({
    queryKey: ["ai-connections", companyId],
    queryFn: () => aiConnectionsApi.list(companyId!),
    enabled: Boolean(companyId && binding),
  });
  const connection = accounts.data?.connections.find((c) =>
    binding?.mode === "responsible_user"
      ? c.provider === binding.provider && c.isDefault && c.ownerUserId === accounts.data?.currentUserId && c.ownership === "personal"
      : c.id === binding?.connectionId && c.grantId === binding?.grantId,
  );
  const routing = connection?.routing;
  const openRouter = routing?.kind === "openrouter" || (!routing && binding?.provider === "openrouter");
  const discover = openRouter && !routing?.models.length;
  // Reuse the existing public catalog and its query cache. It returns OpenCode IDs;
  // strip only that transport prefix for other harnesses (openrouter/auto is
  // itself a valid upstream model ID).
  const catalog = useQuery({
    queryKey: queryKeys.agents.adapterModels(companyId ?? "none", "opencode_local", null, "openrouter"),
    queryFn: () => agentsApi.adapterModels(companyId!, "opencode_local", { provider: "openrouter" }),
    enabled: Boolean(companyId && discover),
    staleTime: 60_000,
    retry: false,
  });
  // A claude_local connection pool's model allow-list (`routing.models`) is operator-entered
  // and carries only {id, label} — it can't know about reasoning efforts. Merge in the
  // server-resolved, on-disk-catalog-aware `efforts` for each id, from the same adapter-models
  // endpoint the non-pooled picker already uses, so a pool-routed agent's effort picker matches
  // what ai-connection-router.ts enforces for that same model.
  const claudeCatalog = useQuery({
    queryKey: queryKeys.agents.adapterModels(companyId ?? "none", "claude_local", null, undefined),
    queryFn: () => agentsApi.adapterModels(companyId!, "claude_local"),
    enabled: Boolean(companyId && binding && isClaudeLocal),
    staleTime: 60_000,
    retry: false,
  });
  const claudeCatalogActive = Boolean(companyId && binding && isClaudeLocal);
  const claudeEfforts = new Map((isClaudeLocal ? claudeCatalog.data ?? [] : []).map((m) => [m.id, m.efforts]));

  const effectiveRouting: AiProviderRouting | undefined = routing ?? (openRouter
    ? { kind: "openrouter", protocol: "chat", auth: "bearer", models: [] }
    : undefined);
  const modelOptions = discover
    ? (catalog.data ?? []).map((m) => ({ ...m, id: harness === "opencode_local" ? m.id : m.id.replace(/^openrouter\//, "") }))
    : routing?.models ?? [];
  return effectiveRouting
    ? {
        models: modelOptions.map((m) => {
          const id = aiRoutingModel(effectiveRouting, harness, m.id);
          const efforts = claudeEfforts.get(id);
          return efforts ? { id, label: m.label ?? m.id, efforts } : { id, label: m.label ?? m.id };
        }),
        isLoading: discover && catalog.isLoading,
        // A claudeCatalog failure only means efforts fall back to bundled values (the model
        // list itself still comes from `routing.models` or `catalog`), but it must still
        // surface rather than fail silently, per AGENTS.md's UI error-surfacing rule.
        error: (discover ? catalog.error : null) ?? (claudeCatalogActive ? claudeCatalog.error : null),
        refreshing: (discover && catalog.isFetching) || (claudeCatalogActive && claudeCatalog.isFetching),
        refreshModels: discover || claudeCatalogActive
          ? async () => {
              await Promise.all([
                ...(discover ? [catalog.refetch()] : []),
                ...(claudeCatalogActive ? [claudeCatalog.refetch()] : []),
              ]);
            }
          : undefined,
        resolveModel: (model: string) =>
          aiRoutingModel(effectiveRouting, harness, model),
      }
    : undefined;
}
