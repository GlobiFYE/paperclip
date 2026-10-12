import { ExternalLink, PackageCheck } from "lucide-react";
import type { CompanyDeliverable } from "@/api/deliverables";
import { Link } from "@/lib/router";
import { formatDate } from "@/lib/utils";

interface DeliverableCardProps {
  deliverable: CompanyDeliverable;
}

/**
 * One finished piece of work (TOP-193): the stored plain-English "what was
 * done" summary, where the result lives, who did and verified it, and when.
 * The card renders stored text only — it never triggers model calls.
 */
export function DeliverableCard({ deliverable }: DeliverableCardProps) {
  const { issue, project, product, doneBy, verifiedBy, summary, generationState } = deliverable;
  return (
    <div
      data-testid="deliverable-card"
      data-generation-status={generationState}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/issues/${issue.id}`}
          disableIssueQuicklook
          className="min-w-0 flex-1 truncate text-sm font-medium leading-6 text-foreground/85 hover:underline"
          title={`${issue.identifier} ${issue.title}`}
        >
          <span className="text-muted-foreground">{issue.identifier}</span>{" "}
          {issue.title}
        </Link>
        <span className="shrink-0 text-(length:--text-micro) text-muted-foreground/65">
          {formatDate(deliverable.completedAt)}
        </span>
      </div>

      {project ? (
        <div className="text-(length:--text-micro) font-medium uppercase tracking-wide text-muted-foreground/60">
          {project.name}
        </div>
      ) : null}

      {summary ? (
        <p className="break-words text-sm leading-6 text-muted-foreground" data-testid="deliverable-summary">
          {summary}
        </p>
      ) : (
        <p className="break-words text-sm leading-6 text-muted-foreground/60 italic" data-testid="deliverable-summary-placeholder">
          {deliverable.fallback}
        </p>
      )}

      {summary && deliverable.summaryFromTaskDetails && <p className="text-xs text-muted-foreground">Summary from task details</p>}
      {generationState === "failed_final" && <p className="text-xs text-muted-foreground">Summary unavailable or out of date. See the task for the latest details.</p>}
      {(generationState === "stale" || (summary && ["pending", "generating", "retry_scheduled"].includes(generationState))) && <p className="text-xs text-muted-foreground">Updating summary…</p>}
      {product ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-accent/20 px-2.5 py-2">
          <div className="text-(length:--text-micro) font-medium uppercase tracking-wide text-muted-foreground/60">
            {product.unavailable ? "Output unavailable" : "Where it is"}
          </div>
          {product.href ? (
            <a
              href={product.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex break-words items-center gap-1 text-sm font-medium text-foreground/85 hover:underline"
            >
              {product.title}
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-sm font-medium text-foreground/85">{product.title}</span>
          )}
          {product.target ? (
            <span className="break-all text-(length:--text-micro) text-muted-foreground/75">
              {product.target}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-(length:--text-micro) text-muted-foreground/60">
          <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>No attached result yet — see the task thread.</span>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-(length:--text-micro) text-muted-foreground/65">
        <span>Done by {doneBy?.name ?? "unknown"}</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{verifiedBy ? `Verified by ${verifiedBy.name}` : "Not yet verified"}</span>
      </div>
    </div>
  );
}
