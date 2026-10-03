export type FinishLineItemStatus = "open" | "done";

/**
 * A project finish-line item: one bullet of "what done looks like" for a
 * project. Tasks (issues) tag the item they serve via `finishLineItemId`.
 * Distinct from the agent-level `Goal` and the project-to-goal linkage.
 */
export interface FinishLineItem {
  id: string;
  companyId: string;
  projectId: string;
  title: string;
  /** The "how it applies to us" instance detail. */
  description: string | null;
  status: FinishLineItemStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Lightweight projection used where the full item is not needed. */
export interface FinishLineItemSummary {
  id: string;
  projectId: string;
  title: string;
  status: FinishLineItemStatus;
  position: number;
}

export interface CreateFinishLineItemRequest {
  title: string;
  description?: string | null;
  status?: FinishLineItemStatus;
  position?: number | null;
}

export interface UpdateFinishLineItemRequest {
  title?: string;
  description?: string | null;
  status?: FinishLineItemStatus;
  position?: number;
}
