export type DeliverableGenerationStatus = "pending" | "generating" | "retry_scheduled" | "generated" | "stale" | "failed_final";

export interface DeliverableIssueSummary {
  id: string;
  identifier: string;
  title: string;
}

export interface DeliverableProjectSummary {
  id: string;
  name: string;
}

export interface DeliverableActor {
  kind: "agent" | "user";
  id: string;
  name: string;
}

export interface DeliverableProduct {
  kind: "preview_url" | "runtime_service" | "pull_request" | "branch" | "commit" | "artifact" | "document";
  title: string;
  /**
   * The final product location: a URL, a workspace-relative file path, or a
   * same-origin attachment path. Plain text so the card can show "where it is"
   * even when nothing is openable from the browser.
   */
  target: string | null;
  /** Same-origin or absolute link the browser can open, when one exists. */
  href: string | null;
  unavailable: boolean;
}

export interface CompanyDeliverable {
  id: string;
  /** Stored plain-English summary, with bounded repairs for late evidence. */
  summary: string | null;
  generationState: DeliverableGenerationStatus;
  nextAttemptAt: string | null;
  fallback: string;
  summaryFromTaskDetails: boolean;
  issue: DeliverableIssueSummary;
  project: DeliverableProjectSummary | null;
  product: DeliverableProduct | null;
  /** Actor who completed the task, falling back to its assignee when history is unavailable. */
  doneBy: DeliverableActor | null;
  /** Who verified it (a different agent with a verification comment), when verified. */
  verifiedBy: DeliverableActor | null;
  completedAt: string;
}

export interface CompanyDeliverablesResponse {
  /** Whether summary credentials currently resolve; never includes credential details. */
  summariesEnabled: boolean;
  deliverables: CompanyDeliverable[];
  nextCursor: string | null;
}
