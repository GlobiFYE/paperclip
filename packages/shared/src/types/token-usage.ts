export type TokenUsageWindow = "today" | "d7" | "d30";

export interface TokenUsageModel {
  name: string;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
}

export interface TokenUsageProvider {
  key: string;
  name: string;
  kind: "cloud" | "local" | "subscription";
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cachedTokens: number;
  requests: number;
  count: number;
  countUnit: "runs" | "calls";
  errors: number;
  rateLimited: number;
  pctUsed: number | null;
  warning: boolean;
  remaining: string | null;
  models: TokenUsageModel[];
}

export interface TokenUsageSummary {
  generatedAt: string;
  generatedAtMs: number;
  window: TokenUsageWindow;
  stale: boolean;
  partial: boolean;
  sources: { name: string; status: "ok" | "skipped" | "error" }[];
  providers: TokenUsageProvider[];
  total: { tokens: number; tokensIn: number; tokensOut: number; cachedTokens: number };
}

export type TokenUsageResponse = TokenUsageSummary | { available: false; reason: string };
