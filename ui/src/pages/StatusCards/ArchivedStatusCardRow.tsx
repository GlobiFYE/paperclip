import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { useTranslation } from "@/i18n";
import { statusCardsApi } from "@/api/statusCards";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/utils";
import { formatCents, formatTokens, rollupUpdates } from "./format";
import type { StatusCardView } from "./types";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ArchivedStatusCardRow({
  card,
  onView,
  onRestore,
  restorePending,
}: {
  card: StatusCardView;
  onView: () => void;
  onRestore: () => void;
  restorePending?: boolean;
}) {
  const { t } = useTranslation();
  const updatesQuery = useQuery({
    queryKey: queryKeys.statusCards.updates(card.id),
    queryFn: () => statusCardsApi.updates(card.id),
  });
  const rollup = updatesQuery.data ? rollupUpdates(updatesQuery.data) : null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{card.title ?? t("statusCards.archivedRow.untitledCard", { defaultValue: "Untitled card" })}</p>
        <p className="mt-0.5 text-xs text-muted-foreground" title={card.archivedAt ? formatDateTime(card.archivedAt) : undefined}>
          {t("statusCards.archivedRow.archived", { defaultValue: "archived {{date}} \u00b7 last summary {{lastSummary}}", date: shortDate(card.archivedAt), lastSummary: shortDate(card.lastGeneratedAt) })}
          {rollup ? ` \u00b7 ${t("statusCards.archivedRow.lifetime", { defaultValue: "lifetime {{tokens}} / {{cost}}", tokens: formatTokens(rollup.totalTokens), cost: formatCents(rollup.totalCostCents) })}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={onView}>
          {t("statusCards.archivedRow.view", { defaultValue: "View" })}
        </Button>
        <Button variant="outline" size="sm" onClick={onRestore} disabled={restorePending}>
          {restorePending ? <Loader2 className="animate-spin" /> : null}
          {t("statusCards.archivedRow.restore", { defaultValue: "Restore" })}
        </Button>
      </div>
    </div>
  );
}
