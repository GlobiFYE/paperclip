import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { finishLineItems, issues, projects } from "@paperclipai/db";
import type {
  CreateFinishLineItem,
  FinishLineItem,
  FinishLineItemStatus,
  UpdateFinishLineItem,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

type FinishLineItemRow = typeof finishLineItems.$inferSelect;

/**
 * Project finish-line item service. Every read and write is company-scoped:
 * callers always pass the companyId from the authenticated route context and
 * the company is part of every predicate below.
 */
export function finishLineItemService(db: Db) {
  async function getRow(companyId: string, id: string): Promise<FinishLineItemRow | null> {
    return db
      .select()
      .from(finishLineItems)
      .where(and(eq(finishLineItems.companyId, companyId), eq(finishLineItems.id, id)))
      .then((rows) => rows[0] ?? null);
  }

  /** Ordered by position, then creation order for stable lane rendering. */
  async function list(companyId: string, projectId: string): Promise<FinishLineItem[]> {
    return db
      .select()
      .from(finishLineItems)
      .where(and(eq(finishLineItems.companyId, companyId), eq(finishLineItems.projectId, projectId)))
      .orderBy(asc(finishLineItems.position), asc(finishLineItems.createdAt))
      .then((rows) => rows as unknown as FinishLineItem[]);
  }

  async function create(
    companyId: string,
    projectId: string,
    input: CreateFinishLineItem,
  ): Promise<FinishLineItem> {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), eq(projects.id, projectId)))
      .then((rows) => rows);
    if (!project) throw notFound("Project not found");

    const [row] = await db
      .insert(finishLineItems)
      .values({
        companyId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? "open",
        position: input.position ?? 0,
      })
      .returning();
    return row as unknown as FinishLineItem;
  }

  async function update(
    companyId: string,
    id: string,
    patch: UpdateFinishLineItem,
  ): Promise<FinishLineItem | null> {
    const existing = await getRow(companyId, id);
    if (!existing) return null;

    const values: Partial<typeof finishLineItems.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.description !== undefined) values.description = patch.description ?? null;
    if (patch.status !== undefined) values.status = patch.status satisfies FinishLineItemStatus;
    if (patch.position !== undefined) values.position = patch.position;

    const [row] = await db
      .update(finishLineItems)
      .set(values)
      .where(and(eq(finishLineItems.companyId, companyId), eq(finishLineItems.id, id)))
      .returning();
    return (row as unknown as FinishLineItem) ?? null;
  }

  /**
   * Deletes the item unless any task (issue) still references it through
   * `issues.finish_line_item_id` — a lane bullet with live task tags is
   * load-bearing and the caller gets a 409 instead of a dangling FK.
   */
  async function remove(companyId: string, id: string): Promise<FinishLineItem | null> {
    const existing = await getRow(companyId, id);
    if (!existing) return null;

    const [referencing] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.finishLineItemId, id))
      .then((rows) => rows);
    if (referencing) {
      throw conflict(
        "Finish-line item is still referenced by tasks; retag or clear those tasks before deleting it",
      );
    }

    await db
      .delete(finishLineItems)
      .where(and(eq(finishLineItems.companyId, companyId), eq(finishLineItems.id, id)));
    return existing as unknown as FinishLineItem;
  }

  return {
    list,
    create,
    update,
    remove,
  };
}
