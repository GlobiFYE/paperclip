import { useMemo, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { SummarySlotIssueRef } from "@paperclipai/shared";
import { AlertTriangle, ExternalLink, Loader2, MoreHorizontal, PauseCircle, RefreshCw, Wand2 } from "lucide-react";

import { useTranslation } from "@/i18n";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useSummaryDraftStream } from "@/components/useSummaryDraftStream";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { cn, relativeTime } from "@/lib/utils";
import {
  deriveStatusCardLifecycle,
  describeRefreshPolicy,
  STATUS_CARD_LIFECYCLE_PRESENTATION,
} from "@/lib/status-card-state";
import { formatCents, formatTokens } from "./format";
import type { StatusCardView } from "./types";

export interface StatusCardTileProps {
  card: StatusCardView;
  companyId: string | null | undefined;
  onOpen: () => void;
  onRefresh: () => void;
  onRecompile: () => void;
  onEditInterest: () => void;
  onOpenDebug: () => void;
  onArchive: () => void;
  refreshPending?: boolean;
  recompilePending?: boolean;
}

function StateDot({ className }: { className: string }) {
  return <span className={cn("mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function stopClick(handler: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };
}

export function StatusCardTile({
  card,
  companyId,
  onOpen,
  onRefresh,
  onRecompile,
  onEditInterest,
  onOpenDebug,
  onArchive,
  refreshPending,
  recompilePending,
}: StatusCardTileProps) {
  const { t } = useTranslation();
  const lifecycle = deriveStatusCardLifecycle(card);
  const presentation = STATUS_CARD_LIFECYCLE_PRESENTATION[lifecycle];
  const setupRunning = lifecycle === "compiling" && Boolean(card.generatingIssueId);

  const generatingIssue = useMemo<SummarySlotIssueRef | null>(
    () =>
      lifecycle === "updating" && card.generatingIssueId
        ? { id: card.generatingIssueId, identifier: null, title: card.title ?? "Status update", status: "in_progress" }
        : null,
    [lifecycle, card.generatingIssueId, card.title],
  );
  const draftStream = useSummaryDraftStream(companyId, generatingIssue);

  const policyLabel = describeRefreshPolicy(card.refreshPolicy);
  const tokensLabel = formatTokens(card.todayTokens);
  const costLabel = formatCents(card.todayCostCents);
  const freshnessLabel = card.lastGeneratedAt ? relativeTime(card.lastGeneratedAt) : t("statusCards.detailDrawer.noSummaryYet", { defaultValue: "No summary yet" });
  const hasSummary = Boolean(card.summaryBody && card.summaryBody.trim().length > 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex h-72 cursor-pointer flex-col rounded-lg border border-border bg-card text-card-foreground transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        presentation.dashedBorder && "border-dashed",
      )}
      data-testid="status-card-tile"
      data-lifecycle={lifecycle}
    >
      <div className="flex items-start gap-2 px-4 pt-4">
        {lifecycle === "compiling" ? null : <StateDot className={presentation.dotClassName} />}
        <span
          className={cn(
            "line-clamp-1 min-w-0 flex-1 text-sm font-semibold",
            lifecycle === "compiling" && "text-muted-foreground",
          )}
          title={card.title ?? card.interestPrompt}
        >
          {card.title ?? t("statusCards.tile.newCardFallback", { defaultValue: "New card" })}
        </span>
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-7 w-7 text-muted-foreground" aria-label={t("statusCards.tile.cardActions", { defaultValue: "Card actions" })}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>{t("statusCards.tile.openDetail", { defaultValue: "Open detail" })}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onRefresh} disabled={refreshPending || lifecycle === "updating"}>
                {t("statusCards.tile.refreshNow", { defaultValue: "Refresh now" })}
              </DropdownMenuItem>
              {(lifecycle === "compiling" && !setupRunning) || lifecycle === "error" ? (
                <DropdownMenuItem onSelect={onRecompile} disabled={recompilePending}>
                  {t("statusCards.tile.runNow", { defaultValue: "Run now" })}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={onEditInterest}>{t("statusCards.tile.editInterest", { defaultValue: "Edit interest & settings" })}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenDebug}>{t("statusCards.tile.queryDebug", { defaultValue: "Query debug" })}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onArchive} variant="destructive">
                {t("statusCards.tile.archive", { defaultValue: "Archive" })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="px-4 pt-2">
        {lifecycle === "compiling" ? (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-foreground" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              {setupRunning ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span>{setupRunning ? t("statusCards.tile.settingUp", { defaultValue: "Setting up your card\u2026" }) : t("statusCards.tile.setupNotFinished", { defaultValue: "Setup didn\u2019t finish" })}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-muted-foreground">{t("statusCards.tile.setupPromptHint", { defaultValue: "\u201c{{prompt}}\u201d", prompt: card.interestPrompt })}</p>
            {setupRunning ? (
              <Link
                to={`/issues/${card.generatingIssueId}`}
                onClick={(event) => event.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("statusCards.tile.viewSetupTask", { defaultValue: "View setup task" })}
              </Link>
            ) : (
              <button
                type="button"
                onClick={stopClick(onRecompile)}
                disabled={recompilePending}
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
              >
                <Wand2 className={cn("h-3.5 w-3.5", recompilePending && "animate-pulse")} />
                {recompilePending ? t("statusCards.tile.starting", { defaultValue: "Starting\u2026" }) : t("statusCards.tile.runNow", { defaultValue: "Run now" })}
              </button>
            )}
          </div>
        ) : null}

        {lifecycle === "updating" ? (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-foreground" role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={draftStream.statusLine ?? undefined}>
                {draftStream.statusLine
                  ?? (card.pendingChangeCount > 0
                    ? t("statusCards.tile.integratingChanges", { defaultValue: "Integrating {{count}} {{label}}\u2026", count: card.pendingChangeCount, label: t(card.pendingChangeCount === 1 ? "statusCards.tile.change_one" : "statusCards.tile.change_other", { defaultValue: card.pendingChangeCount === 1 ? "change" : "changes" }) })
                    : t("statusCards.tile.updatingNow", { defaultValue: "Updating now\u2026" }))}
              </span>
              {card.generatingIssueId ? (
                <Link
                  to={createIssueDetailPath(card.generatingIssueId)}
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("statusCards.tile.viewUpdateTask", { defaultValue: "View update task" })}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {lifecycle === "stale" ? (
          <button
            type="button"
            onClick={stopClick(onRefresh)}
            disabled={refreshPending}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-amber-500/10 disabled:opacity-60"
          >
            <span>
              {t(card.pendingChangeCount === 1 ? "statusCards.tile.changesSinceLastUpdate_one" : "statusCards.tile.changesSinceLastUpdate_other", { defaultValue: card.pendingChangeCount === 1 ? "{{count}} change since last update" : "{{count}} changes since last update", count: card.pendingChangeCount })}
            </span>
            <span className="shrink-0 font-medium text-amber-700 dark:text-amber-400">{t("statusCards.tile.refresh", { defaultValue: "Refresh" })}</span>
          </button>
        ) : null}

        {lifecycle === "error" ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("statusCards.tile.lastUpdateFailed", { defaultValue: "Last update failed" })}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={stopClick(onRefresh)} disabled={refreshPending} className="font-medium text-destructive hover:underline disabled:opacity-60">
                {t("statusCards.tile.retry", { defaultValue: "Retry" })}
              </button>
              <button type="button" onClick={stopClick(onOpen)} className="text-muted-foreground hover:underline">
                {t("statusCards.tile.details", { defaultValue: "Details" })}
              </button>
            </span>
          </div>
        ) : null}

        {lifecycle === "paused_budget" || lifecycle === "paused_hours" ? (
          <div className="flex items-center gap-2 rounded-md border border-orange-500/40 bg-orange-500/5 px-3 py-1.5 text-xs text-foreground">
            <PauseCircle className="h-3.5 w-3.5 shrink-0 text-orange-500" />
            <span>
              {lifecycle === "paused_budget"
                ? t("statusCards.tile.dailyCapReached", { defaultValue: "Daily token cap reached \u2014 auto-updates paused" })
                : t("statusCards.tile.outsideHours", { defaultValue: "Outside active hours \u2014 auto-updates paused" })}
            </span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-2">
        {lifecycle === "error" && card.summaryBody ? (
          <p className="mb-1 text-(length:--text-micro) text-muted-foreground">{t("statusCards.tile.showingLastGoodSummary", { defaultValue: "Showing last good summary:" })}</p>
        ) : null}
        {hasSummary ? (
          <MarkdownBody className="text-xs leading-6 text-foreground [&_p]:my-0.5">{card.summaryBody!}</MarkdownBody>
        ) : lifecycle === "compiling" ? (
          <p className="text-xs text-muted-foreground">
            {t("statusCards.tile.setupHint", { defaultValue: "You can add instructions and pick an update policy while this runs." })}
          </p>
        ) : lifecycle === "updating" && draftStream.draft ? (
          <MarkdownBody className="text-xs leading-6 text-foreground [&_p]:my-0.5">{draftStream.draft}</MarkdownBody>
        ) : (
          <p className="text-xs text-muted-foreground">{t("statusCards.tile.noSummaryYet", { defaultValue: "No summary yet." })}</p>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span className="truncate text-(length:--text-micro) text-muted-foreground">
          {lifecycle === "compiling" ? (
            t("statusCards.tile.settingUpFooter", { defaultValue: "setting up \u00b7 first summary pending" })
          ) : (
            <>
              {freshnessLabel} · {policyLabel}
              {tokensLabel ? ` \u00b7 ${tokensLabel}` : ""}
              {costLabel ? ` \u00b7 ${costLabel}` : ""}
            </>
          )}
        </span>
        {lifecycle === "fresh" || lifecycle === "paused_budget" || lifecycle === "paused_hours" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={stopClick(onRefresh)}
            disabled={refreshPending}
            aria-label={t("statusCards.tile.refreshCard", { defaultValue: "Refresh card" })}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshPending && "animate-spin")} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
