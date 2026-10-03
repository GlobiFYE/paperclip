export type FinishLineItemStatus = "open" | "done";

/**
 * A task (issue) nested under the bullet it serves. Linked automatically
 * through `issues.finish_line_item_id` — never wired by hand. Non-done tasks
 * come first (the live work), done after (the record of what got it done).
 */
export interface FinishLineItemTask {
  id: string;
  title: string;
  status: string;
}

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
  /** Tasks tagged to this bullet, nested for display under the item. */
  tasks?: FinishLineItemTask[];
}

/** Lightweight projection used where the full item is not needed. */
export interface FinishLineItemSummary {
  id: string;
  projectId: string;
  title: string;
  status: FinishLineItemStatus;
  position: number;
  /** Tasks tagged to this bullet, when the caller wants them nested. */
  tasks?: FinishLineItemTask[];
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
