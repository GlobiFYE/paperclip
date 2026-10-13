import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TokenUsageProvider, TokenUsageWindow } from "@paperclipai/shared";
import { tokenUsageApi } from "../api/tokenUsage";
import { ApiError } from "../api/client";
import { formatNumber, formatTokens } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

const windows: { value: TokenUsageWindow; label: string }[] = [
  { value: "today", label: "Today" }, { value: "d7", label: "7 days" }, { value: "d30", label: "30 days" },
];
const kindLabels = { cloud: "Cloud", local: "Local", subscription: "Subscription" };

function ProviderRow({ provider, max }: { provider: TokenUsageProvider; max: number }) {
  const [expanded, setExpanded] = useState(false);
  const modelsId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="token-usage-provider">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="ghost" className="h-auto min-w-0 justify-start whitespace-normal break-all px-0 text-left" aria-expanded={expanded} aria-controls={modelsId} onClick={() => setExpanded((value) => !value)}>
            {provider.name}
          </Button>
          <Badge variant="secondary">{kindLabels[provider.kind]}</Badge>
          {provider.warning && <Badge variant="outline" className="text-(--status-task-icon-todo)">near limit</Badge>}
          {provider.rateLimited > 0 && <Badge variant="outline">limited {formatNumber(provider.rateLimited)}x</Badge>}
        </div>
        <div className="flex shrink-0 flex-wrap items-baseline gap-2 font-mono">
          <span>{formatTokens(provider.tokens)}</span>
          <span className="text-xs text-muted-foreground">{formatNumber(provider.count)} {provider.countUnit}</span>
        </div>
      </div>
      {max > 0 && provider.tokens > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {/* Width represents usage data, not a fixed design value. */}
          <div className="h-full rounded-full bg-primary" style={{ width: `${provider.tokens / max * 100}%` }} />
        </div>
      )}
      <div id={modelsId} hidden={!expanded}>
        {expanded && (
          <ul className="flex min-w-0 flex-col gap-2 pl-4 text-sm">
            {provider.models.map((model) => (
              <li key={model.name} className="flex min-w-0 flex-col gap-1 sm:flex-row sm:justify-between">
                <span className="min-w-0 break-all">{model.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{formatTokens(model.tokens)} tokens · {formatNumber(model.calls)} {provider.countUnit}</span>
              </li>
            ))}
            {provider.models.length === 0 && <li className="text-muted-foreground">No model usage reported.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export function TokenUsage({ companyId }: { companyId: string }) {
  const [window, setWindow] = useState<TokenUsageWindow>("d7");
  const { data, error, isPending } = useQuery({
    queryKey: ["token-usage", companyId, window],
    queryFn: ({ signal }) => tokenUsageApi.get(companyId, window, signal),
    // Stop polling once access is denied (non-admin members never see this card).
    refetchInterval: (query) => (query.state.error instanceof ApiError && query.state.error.status === 403 ? false : 5 * 60 * 1000),
    retry: false,
  });
  if (error instanceof ApiError && error.status === 403) return null;
  const summary = data && !("available" in data) && !error ? data : null;
  const max = summary ? Math.max(0, ...summary.providers.map((provider) => provider.tokens)) : 0;
  return (
    <Card className="min-w-0" data-testid="token-usage-card">
      <CardHeader>
        <CardTitle>AI token usage</CardTitle>
        <CardDescription>All AI usage on this machine</CardDescription>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Usage window">
          {windows.map((option) => (
            <Button key={option.value} size="sm" variant={window === option.value ? "secondary" : "ghost"} aria-pressed={window === option.value} onClick={() => setWindow(option.value)}>{option.label}</Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {isPending ? <p className="text-sm text-muted-foreground">Loading token usage…</p> : !summary ? (
          <p className="text-sm text-muted-foreground">Token usage isn't available right now.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-mono text-3xl" data-testid="token-usage-total">{formatTokens(summary.total.tokens)}</span>
              <span className="text-sm text-muted-foreground">tokens</span>
              {summary.total.cachedTokens > 0 && <span className="font-mono text-xs text-muted-foreground">+ {formatTokens(summary.total.cachedTokens)} cached</span>}
            </div>
            {summary.providers.map((provider) => <ProviderRow key={`${companyId}:${window}:${provider.key}`} provider={provider} max={max} />)}
            {summary.partial && <p className="text-sm text-muted-foreground">Some usage sources weren't refreshed, so totals may be low.</p>}
          </>
        )}
      </CardContent>
      {summary && (
        <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
          <span>Updated {timeAgo(summary.generatedAt).replace(/(\d+)m ago$/, "$1 min ago")}</span>
          {summary.stale && <span className="text-(--status-task-icon-todo) opacity-80">Usage data is over an hour old</span>}
        </CardFooter>
      )}
    </Card>
  );
}
