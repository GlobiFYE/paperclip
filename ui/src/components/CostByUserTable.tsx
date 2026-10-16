import type { CostByUserReport } from "@paperclipai/shared";
import { CostAmount } from "./CostAmount";
import { Identity } from "./Identity";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { formatTokens } from "../lib/utils";
import { useTranslation } from "@/i18n";

export function CostByUserTable({ report }: { report: CostByUserReport }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-0 px-5">
        <CardTitle className="text-base">{t("costs.byUser", { defaultValue: "By user" })}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="overflow-x-auto">
          <table aria-label={t("costs.ariaLabel", { defaultValue: "Costs by user" })} className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 text-left font-medium">{t("costs.thUser", { defaultValue: "User" })}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t("costs.thRuns", { defaultValue: "Runs" })}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t("costs.thInput", { defaultValue: "Input" })}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t("costs.thOutput", { defaultValue: "Output" })}</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">{t("costs.thCost", { defaultValue: "Cost" })}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-muted-foreground">{t("costs.noCosts", { defaultValue: "No user-attributed costs yet." })}</td></tr>
              )}
              {report.rows.map(row => (
                <tr key={row.userId ?? "unattributed"} className="border-b border-border last:border-0">
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    {row.userId ? <Identity name={row.userName ?? t("costs.unknownUser", { defaultValue: "Unknown user" })} avatarUrl={row.userImage} /> : t("costs.unattributed", { defaultValue: "Unattributed" })}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums">{row.runCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatTokens(row.inputTokens + row.cachedInputTokens)}
                    {row.cachedInputTokens > 0 && <div className="whitespace-nowrap text-xs text-muted-foreground">{t("costs.cached", { defaultValue: "{{tokens}} cached", tokens: formatTokens(row.cachedInputTokens) })}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td className="py-3 pl-4 text-right tabular-nums">
                    <CostAmount costCents={row.costCents} eventCount={row.eventCount} estimatedEventCount={row.estimatedEventCount} unpricedEventCount={row.unpricedEventCount} />
                    {row.unpricedEventCount > 0 && <div className="whitespace-nowrap text-xs text-muted-foreground">{row.unpricedEventCount === 1 ? t("costs.unpriced", { defaultValue: "{{count}} unpriced charge", count: row.unpricedEventCount }) : t("costs.unpriced_other", { defaultValue: "{{count}} unpriced charges", count: row.unpricedEventCount })}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.rows.some(row => row.userId === null) && (
          <p className="mt-3 text-xs text-muted-foreground">{t("costs.unattributedHint", { defaultValue: "Unattributed costs have no recorded user in this organization." })}</p>
        )}
      </CardContent>
    </Card>
  );
}
