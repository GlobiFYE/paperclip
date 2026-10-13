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

// Provider ids as adapters persist them (hermes `provider`, paperclip_runner
// `provider`, Pi/OpenCode `provider/model` prefixes), mapped to display names.
const PROVIDER_NAMES: Record<string, string> = {
  xiaomi: "MiMo",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  gemini: "Gemini",
  xai: "Grok",
  anthropic: "Claude",
  claude: "Claude",
  claude_managed: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  grok: "Grok",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

// Adapters whose `model` is written as `provider/model` (their execute.ts parseModelProvider).
const PREFIXED_MODEL_ADAPTERS = new Set(["pi_local", "opencode_local"]);

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
  hermes_local: "Hermes",
  hermes: "Hermes",
  paperclip_runner: "Paperclip runner",
  process: "Process (no model)",
  http: "HTTP",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function agentProvider(agent: AgentModelGroupInput): string {
  const config = agent.adapterConfig ?? {};
  const client = ADAPTER_PROVIDERS[agent.adapterType] ?? agent.adapterType;
  // Any adapter that persists a provider id (hermes, paperclip_runner, ...) is grouped by it.
  const provider = text(config.provider);
  if (provider) return PROVIDER_NAMES[provider.toLowerCase()] ?? `${client} · ${provider}`;
  if (PREFIXED_MODEL_ADAPTERS.has(agent.adapterType)) {
    const model = text(config.model);
    const slash = model?.indexOf("/") ?? -1;
    if (model && slash > 0) {
      const prefix = model.slice(0, slash).trim().toLowerCase();
      return PROVIDER_NAMES[prefix] ?? prefix;
    }
  }
  if (agent.adapterType === "hermes_local" || agent.adapterType === "hermes" || PREFIXED_MODEL_ADAPTERS.has(agent.adapterType) || agent.adapterType === "paperclip_runner") {
    return `${client} (default provider)`;
  }
  return client;
}

export function agentModel(agent: AgentModelGroupInput): string {
  if (agent.adapterType === "process") return "—";
  const model = text(agent.adapterConfig?.model);
  if (!model) return "default model";
  if (PREFIXED_MODEL_ADAPTERS.has(agent.adapterType) && model.includes("/")) return model.slice(model.indexOf("/") + 1).trim() || model;
  return model;
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
