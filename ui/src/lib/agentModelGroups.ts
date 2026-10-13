// Groups agents by the AI provider and model they run on, for the Agents
// "By model" tab. Derived only from adapterType and the non-secret
// adapterConfig.provider / adapterConfig.model fields; env is never read.

export interface AgentModelGroupInput {
  id: string;
  adapterType: string;
  adapterConfig?: Record<string, unknown> | null;
}

export interface AgentModelGroup<A extends AgentModelGroupInput> {
  provider: string;
  count: number;
  models: { model: string; agents: A[] }[];
}

const HERMES_PROVIDERS: Record<string, string> = {
  xiaomi: "MiMo",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  gemini: "Gemini",
  xai: "Grok",
  anthropic: "Claude",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const ADAPTER_PROVIDERS: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  grok_local: "Grok",
  gemini_local: "Gemini",
  cursor_local: "Cursor",
  cursor_cloud: "Cursor",
  kimi_local: "Kimi",
  opencode_local: "OpenCode",
  pi_local: "Pi",
  openclaw_gateway: "OpenClaw",
  hermes_gateway: "Hermes gateway",
  process: "Process (no model)",
  http: "HTTP",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function agentProvider(agent: AgentModelGroupInput): string {
  const config = agent.adapterConfig ?? {};
  if (agent.adapterType === "hermes_local" || agent.adapterType === "hermes") {
    const provider = text(config.provider);
    if (!provider) return "Hermes (default provider)";
    return HERMES_PROVIDERS[provider.toLowerCase()] ?? `Hermes · ${provider}`;
  }
  return ADAPTER_PROVIDERS[agent.adapterType] ?? agent.adapterType;
}

export function agentModel(agent: AgentModelGroupInput): string {
  if (agent.adapterType === "process") return "—";
  return text(agent.adapterConfig?.model) ?? "default model";
}

export function groupAgentsByModel<A extends AgentModelGroupInput>(agents: A[]): AgentModelGroup<A>[] {
  const providers = new Map<string, Map<string, A[]>>();
  for (const agent of agents) {
    const provider = agentProvider(agent);
    const model = agentModel(agent);
    const models = providers.get(provider) ?? new Map<string, A[]>();
    models.set(model, [...(models.get(model) ?? []), agent]);
    providers.set(provider, models);
  }
  return [...providers.entries()]
    .map(([provider, models]) => ({
      provider,
      count: [...models.values()].reduce((sum, list) => sum + list.length, 0),
      models: [...models.entries()]
        .map(([model, list]) => ({ model, agents: list }))
        .sort((a, b) => b.agents.length - a.agents.length || a.model.localeCompare(b.model)),
    }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
}
