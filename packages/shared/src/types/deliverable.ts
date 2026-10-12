export type DeliverableGenerationStatus = "pending" | "generated" | "failed";

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
}

export interface CompanyDeliverable {
  id: string;
  /** Plain-English "what was done" summary, written once at completion. */
  summary: string | null;
  generationStatus: DeliverableGenerationStatus;
  issue: DeliverableIssueSummary;
  project: DeliverableProjectSummary | null;
  product: DeliverableProduct | null;
  /** Who did the work (the task assignee). */
  doneBy: DeliverableActor | null;
  /** Who verified it (the approver of the linked approval), when verified. */
  verifiedBy: DeliverableActor | null;
  completedAt: string;
}

export interface CompanyDeliverablesResponse {
  deliverables: CompanyDeliverable[];
  nextCursor: string | null;
}
