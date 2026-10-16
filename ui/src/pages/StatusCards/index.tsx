import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Plus } from "lucide-react";

import { useTranslation } from "@/i18n";
import { statusCardsApi } from "@/api/statusCards";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useNavigate, useParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { InlineBanner } from "@/components/InlineBanner";
import { formatCents, formatTokens } from "./format";
import { StatusCardTile } from "./StatusCardTile";
import { ArchivedStatusCardRow } from "./ArchivedStatusCardRow";
import { CreateStatusCardDialog } from "./CreateStatusCardDialog";
import { StatusCardDetailDrawer } from "./StatusCardDetailDrawer";
import type { StatusCardView } from "./types";

export function StatusCards() {
  const { t } = useTranslation();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cardId } = useParams<{ cardId?: string }>();

  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("summary");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: t("statusCards.title", { defaultValue: "Status" }) }]);
  }, [setBreadcrumbs, t]);

  const activeQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.statusCards.list(selectedCompanyId, false) : ["status-cards", "none", "active"],
    queryFn: () => statusCardsApi.list(selectedCompanyId!, false),
    enabled: Boolean(selectedCompanyId),
  });
  const archivedQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.statusCards.list(selectedCompanyId, true) : ["status-cards", "none", "archived"],
    queryFn: () => statusCardsApi.list(selectedCompanyId!, true),
    enabled: Boolean(selectedCompanyId),
  });

  const activeCards = (activeQuery.data ?? []) as StatusCardView[];
  const archivedCards = (archivedQuery.data ?? []) as StatusCardView[];

  const cardInLists = useMemo(
    () => [...activeCards, ...archivedCards].find((card) => card.id === cardId) ?? null,
    [activeCards, archivedCards, cardId],
  );
  const detailFallbackQuery = useQuery({
    queryKey: cardId ? queryKeys.statusCards.detail(cardId) : ["status-cards", "detail", "none"],
    queryFn: () => statusCardsApi.get(cardId!),
    enabled: Boolean(cardId) && !cardInLists,
  });
  const detailCard = (cardInLists ?? detailFallbackQuery.data ?? null) as StatusCardView | null;

  const invalidateLists = () =>
    selectedCompanyId
      ? Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.statusCards.list(selectedCompanyId, false) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.statusCards.list(selectedCompanyId, true) }),
        ])
      : Promise.resolve();

  const refreshMutation = useMutation({
    mutationFn: (id: string) => statusCardsApi.refresh(id),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateLists(),
    onError: (err) => setActionError(err instanceof Error ? err.message : t("statusCards.errors.refresh", { defaultValue: "Could not refresh the card." })),
  });
  const recompileMutation = useMutation({
    mutationFn: (id: string) => statusCardsApi.recompile(id),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateLists(),
    onError: (err) => setActionError(err instanceof Error ? err.message : t("statusCards.errors.recompile", { defaultValue: "Could not run the card." })),
  });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => statusCardsApi.patch(id, { archived: true }),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateLists(),
    onError: (err) => setActionError(err instanceof Error ? err.message : t("statusCards.errors.archive", { defaultValue: "Could not archive the card." })),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => statusCardsApi.patch(id, { archived: false }),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateLists(),
    onError: (err) => setActionError(err instanceof Error ? err.message : t("statusCards.errors.restore", { defaultValue: "Could not restore the card." })),
  });

  const openDetail = (id: string, tab: string = "summary") => {
    setDetailTab(tab);
    navigate(`/status/${id}`);
  };
  const closeDetail = () => navigate("/status");

  const todayTotals = activeCards.reduce(
    (acc, card) => ({
      tokens: acc.tokens + (card.todayTokens ?? 0),
      cents: acc.cents + (card.todayCostCents ?? 0),
    }),
    { tokens: 0, cents: 0 },
  );
  const showCostMeter = todayTotals.tokens > 0 || todayTotals.cents > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{t("statusCards.title", { defaultValue: "Status" })}</h1>
          <Badge variant="secondary" className="gap-1">
            <FlaskConical className="h-3 w-3" />
            {t("statusCards.experimental", { defaultValue: "Experimental" })}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          {showCostMeter ? (
            <span className="text-xs text-muted-foreground">
              {t("statusCards.today", { defaultValue: "Today: {{tokens}} \u00b7 ~{{cost}}", tokens: formatTokens(todayTotals.tokens), cost: formatCents(todayTotals.cents) })}
            </span>
          ) : null}
          <Button onClick={() => setCreateOpen(true)} disabled={!selectedCompanyId}>
            <Plus className="h-4 w-4" />
            {t("statusCards.newCard", { defaultValue: "New card" })}
          </Button>
        </div>
      </div>

      {actionError ? <InlineBanner tone="warning" title={t("statusCards.headsUp", { defaultValue: "Heads up" })}>{actionError}</InlineBanner> : null}

      {activeQuery.isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("statusCards.loading", { defaultValue: "Loading cards\u2026" })}
        </div>
      ) : activeQuery.isError ? (
        <InlineBanner tone="danger" title={t("statusCards.loadError", { defaultValue: "Could not load status cards" })}>
          {activeQuery.error instanceof Error ? activeQuery.error.message : t("statusCards.tryAgain", { defaultValue: "Try again." })}
        </InlineBanner>
      ) : activeCards.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={t("statusCards.emptyTitle", { defaultValue: "No status cards yet" })}
          message={t("statusCards.emptyMessage", { defaultValue: "Create a card to keep a living summary of the issues you care about." })}
          action={selectedCompanyId ? t("statusCards.newCard", { defaultValue: "New card" }) : undefined}
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {activeCards.map((card) => (
            <StatusCardTile
              key={card.id}
              card={card}
              companyId={selectedCompanyId}
              onOpen={() => openDetail(card.id)}
              onRefresh={() => refreshMutation.mutate(card.id)}
              onRecompile={() => recompileMutation.mutate(card.id)}
              onEditInterest={() => openDetail(card.id, "settings")}
              onOpenDebug={() => openDetail(card.id, "settings")}
              onArchive={() => archiveMutation.mutate(card.id)}
              refreshPending={refreshMutation.isPending && refreshMutation.variables === card.id}
              recompilePending={recompileMutation.isPending && recompileMutation.variables === card.id}
            />
          ))}
        </div>
      )}

      {archivedCards.length > 0 ? (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showArchived ? t("statusCards.hideArchived", { defaultValue: "Hide archived" }) : t("statusCards.showArchived", { defaultValue: "Show archived ({{count}})", count: archivedCards.length })}
          </button>
          {showArchived
            ? archivedCards.map((card) => (
                <ArchivedStatusCardRow
                  key={card.id}
                  card={card}
                  onView={() => openDetail(card.id)}
                  onRestore={() => restoreMutation.mutate(card.id)}
                  restorePending={restoreMutation.isPending && restoreMutation.variables === card.id}
                />
              ))
            : null}
        </div>
      ) : null}

      {selectedCompanyId ? (
        <CreateStatusCardDialog companyId={selectedCompanyId} open={createOpen} onOpenChange={setCreateOpen} />
      ) : null}

      <StatusCardDetailDrawer
        card={detailCard}
        companyId={selectedCompanyId}
        open={Boolean(cardId)}
        onOpenChange={(open) => (open ? undefined : closeDetail())}
        initialTab={detailTab}
      />
    </div>
  );
}

export default StatusCards;
