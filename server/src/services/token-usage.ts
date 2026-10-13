import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { TokenUsageProvider, TokenUsageResponse, TokenUsageWindow } from "@paperclipai/shared";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counters = z.object({
  requests: counter,
  tokens_in: counter,
  tokens_out: counter,
  cache_read_tokens: counter,
  errors: counter,
  rate_429: counter,
});
const providerSchema = z.object({
  display: z.string(),
  total: counters,
  models: z.record(z.string(), counters).default({}),
  pct_used: z.number().finite().nullable().default(null),
  warning: z.boolean().default(false),
  remaining_display: z.string().nullable().default(null),
});
// Only the selected window is validated strictly, and `collection` is read loosely, so a new collector field,
// a new status word, or one bad counter in another window never blanks the whole card.
const windowSchema = z.object({ providers: z.record(z.string(), providerSchema) });
const summarySchema = z.object({
  generated_at: z.string(),
  windows: z.record(z.string(), z.unknown()),
  collection: z.record(z.string(), z.unknown()).optional(),
});
type SourceStatus = "ok" | "skipped" | "error";
const sourceStatus = (value: unknown): SourceStatus | null =>
  value === undefined ? null : value === "ok" || value === "skipped" ? value : "error";
const sourceNames = ["hermes_state_db", "hermes_logs", "paperclip_runs"] as const;

/** Resolve collector wall time independently of the server's timezone.
 * At a fall-back fold choose the earlier instant; reject nonexistent wall times.
 */
export function parseCollectorTime(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) throw new Error("Invalid timestamp");
  const wallMs = Date.parse(`${value}Z`);
  if (!Number.isFinite(wallMs) || new Date(wallMs).toISOString().slice(0, 19) !== value) {
    throw new Error("Invalid timestamp");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const localMs = (ms: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(ms).map((part) => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const day = 24 * 60 * 60 * 1000;
  const offsets = new Set([-day, 0, day].map((delta) => localMs(wallMs + delta) - (wallMs + delta)));
  const candidates = [...offsets].map((offset) => wallMs - offset).filter((ms) => localMs(ms) === wallMs);
  if (candidates.length === 0) throw new Error("Nonexistent timestamp");
  const generatedAtMs = Math.min(...candidates);
  const offsetMinutes = (wallMs - generatedAtMs) / 60_000;
  const abs = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return { generatedAt: `${value}${offset}`, generatedAtMs };
}

function hasUsage(total: z.infer<typeof counters>, warning = false) {
  return warning || Object.values(total).some((value) => value > 0);
}

export async function readTokenUsage(window: TokenUsageWindow): Promise<TokenUsageResponse> {
  let text: string;
  try {
    text = await readFile(process.env.PANTHEON_USAGE_SUMMARY_PATH ?? "/Volumes/AI-Models/paperclip/usage/summary.json", "utf8");
  } catch {
    return { available: false, reason: "unreadable" };
  }
  try {
    const summary = summarySchema.parse(JSON.parse(text));
    const parsedWindow = windowSchema.safeParse(summary.windows[window]);
    if (!parsedWindow.success) return { available: false, reason: "malformed" };
    const selected = parsedWindow.data;
    const timestamp = parseCollectorTime(summary.generated_at, process.env.PANTHEON_USAGE_TZ ?? "America/Los_Angeles");
    const providers: TokenUsageProvider[] = Object.entries(selected.providers)
      .filter(([, provider]) => hasUsage(provider.total, provider.warning))
      .map(([key, provider]) => {
        const total = provider.total;
        const kind = key.startsWith("local") ? "local" : key === "claude" || key === "openai" ? "subscription" : "cloud";
        return {
          key, name: provider.display, kind,
          tokensIn: total.tokens_in, tokensOut: total.tokens_out, tokens: total.tokens_in + total.tokens_out,
          cachedTokens: total.cache_read_tokens, requests: total.requests,
          count: total.requests, countUnit: kind === "subscription" ? "runs" : "calls",
          errors: total.errors, rateLimited: total.rate_429,
          pctUsed: provider.pct_used, warning: provider.warning, remaining: provider.remaining_display,
          models: Object.entries(provider.models)
            .filter(([, model]) => hasUsage(model))
            .map(([name, model]) => ({ name, tokens: model.tokens_in + model.tokens_out, tokensIn: model.tokens_in, tokensOut: model.tokens_out, calls: model.requests }))
            .sort((a, b) => b.tokens - a.tokens),
        };
      });
    providers.sort((a, b) => b.tokens - a.tokens);
    const total = providers.reduce((sum, provider) => ({
      tokens: sum.tokens + provider.tokens,
      tokensIn: sum.tokensIn + provider.tokensIn,
      tokensOut: sum.tokensOut + provider.tokensOut,
      cachedTokens: sum.cachedTokens + provider.cachedTokens,
    }), { tokens: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0 });
    const sources = sourceNames.flatMap((name) => {
      const status = sourceStatus(summary.collection?.[name]);
      return status ? [{ name, status }] : [];
    });
    return {
      ...timestamp, window, stale: Date.now() - timestamp.generatedAtMs > 3_600_000,
      partial: !summary.collection || sourceNames.some((name) => summary.collection?.[name] !== "ok")
        || Object.values(summary.collection).some((status) => status !== "ok"),
      sources, providers, total,
    };
  } catch {
    return { available: false, reason: "malformed" };
  }
}
