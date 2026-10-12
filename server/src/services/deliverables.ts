import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import {
  agents,
  approvals,
  authUsers,
  issueApprovals,
  issueDeliverables,
  issueWorkProducts,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";
import {
  COMPANY_DELIVERABLES_MAX_LIMIT,
  type CompanyDeliverable,
  type CompanyDeliverablesQuery,
  type CompanyDeliverablesResponse,
  type DeliverableActor,
  type DeliverableProduct,
} from "@paperclipai/shared";
import { badRequest } from "../errors.js";

type DeliverableCursor = {
  completedAt: string;
  id: string;
};

function encodeCursor(cursor: DeliverableCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): DeliverableCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<DeliverableCursor>;
    if (typeof parsed.id !== "string" || typeof parsed.completedAt !== "string") {
      throw new Error("Invalid cursor");
    }
    const date = new Date(parsed.completedAt);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid cursor");
    return { id: parsed.id, completedAt: date.toISOString() };
  } catch {
    throw badRequest("Invalid deliverables cursor");
  }
}

function parseDateBound(value: string | undefined, name: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${name} date`);
  return date;
}

function resolveProduct(row: {
  type: string;
  title: string;
  url: string | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
}): DeliverableProduct {
  const metadata = (row.metadata ?? {}) as {
    openPath?: unknown;
    originalFilename?: unknown;
    resourceRef?: { path?: unknown };
  };
  const openPath = typeof metadata.openPath === "string" ? metadata.openPath : null;
  const resourcePath =
    typeof metadata.resourceRef?.path === "string" ? metadata.resourceRef.path : null;
  const target =
    row.url ??
    resourcePath ??
    openPath ??
    (typeof metadata.originalFilename === "string" ? metadata.originalFilename : null) ??
    row.externalId;
  const href = row.url ?? openPath;
  return {
    kind: row.type as DeliverableProduct["kind"],
    title: row.title,
    target: target ?? null,
    href: href ?? null,
  };
}

export function deliverablesService(db: Db) {
  async function list(
    companyId: string,
    query: CompanyDeliverablesQuery,
  ): Promise<CompanyDeliverablesResponse> {
    const cursor = decodeCursor(query.cursor);
    const from = parseDateBound(query.from, "from");
    const to = parseDateBound(query.to, "to");
    const limit = Math.min(Math.max(query.limit ?? COMPANY_DELIVERABLES_MAX_LIMIT, 1), COMPANY_DELIVERABLES_MAX_LIMIT);

    const conditions: (SQL | undefined)[] = [
      eq(issues.companyId, companyId),
      eq(issues.status, "done"),
      isNull(issues.hiddenAt),
      isNotNull(issues.completedAt),
    ];
    if (query.projectId) conditions.push(eq(issues.projectId, query.projectId));
    // Date bounds on the completion date: from inclusive, to exclusive.
    if (from) conditions.push(gte(issues.completedAt, from));
    if (to) conditions.push(lt(issues.completedAt, to));
    if (cursor) {
      conditions.push(
        or(
          lt(issues.completedAt, new Date(cursor.completedAt)),
          and(
            eq(issues.completedAt, new Date(cursor.completedAt)),
            lt(issues.id, cursor.id),
          ),
        ),
      );
    }

    const rows = await db
      .select({
        deliverableId: issueDeliverables.id,
        summary: issueDeliverables.summary,
        generationStatus: issueDeliverables.generationStatus,
        issueId: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        completedAt: issues.completedAt,
        assigneeAgentId: issues.assigneeAgentId,
        assigneeUserId: issues.assigneeUserId,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(issues)
      .leftJoin(issueDeliverables, eq(issueDeliverables.issueId, issues.id))
      .leftJoin(projects, eq(projects.id, issues.projectId))
      .where(and(...conditions))
      .orderBy(desc(issues.completedAt), desc(issues.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeCursor({
            completedAt: (page[page.length - 1].completedAt as Date).toISOString(),
            id: page[page.length - 1].issueId,
          })
        : null;

    const issueIds = page.map((row) => row.issueId);
    const productsByIssue = new Map<string, DeliverableProduct>();
    const doneByAgent = new Map<string, string>();
    const doneByUser = new Map<string, string>();
    const verifiedBy = new Map<string, DeliverableActor>();

    if (issueIds.length > 0) {
      const productRows = await db
        .select({
          issueId: issueWorkProducts.issueId,
          type: issueWorkProducts.type,
          title: issueWorkProducts.title,
          url: issueWorkProducts.url,
          externalId: issueWorkProducts.externalId,
          metadata: issueWorkProducts.metadata,
          isPrimary: issueWorkProducts.isPrimary,
          createdAt: issueWorkProducts.createdAt,
        })
        .from(issueWorkProducts)
        .where(and(eq(issueWorkProducts.companyId, companyId), inArray(issueWorkProducts.issueId, issueIds)))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.createdAt));
      for (const row of productRows) {
        if (productsByIssue.has(row.issueId)) continue;
        productsByIssue.set(row.issueId, resolveProduct(row));
      }

      const agentIds = page
        .map((row) => row.assigneeAgentId)
        .filter((id): id is string => !!id);
      if (agentIds.length > 0) {
        const agentRows = await db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)));
        for (const row of agentRows) doneByAgent.set(row.id, row.name);
      }

      const userIds = page.map((row) => row.assigneeUserId).filter((id): id is string => !!id);
      const userRows = userIds.length
        ? await db.select({ id: authUsers.id, name: authUsers.name }).from(authUsers).where(inArray(authUsers.id, userIds))
        : [];
      const userNames = new Map(userRows.map((row) => [row.id, row.name]));

      const approvalRows = await db
        .select({
          issueId: issueApprovals.issueId,
          decidedByUserId: approvals.decidedByUserId,
          decidedAt: approvals.decidedAt,
          name: authUsers.name,
        })
        .from(issueApprovals)
        .innerJoin(approvals, eq(approvals.id, issueApprovals.approvalId))
        .leftJoin(authUsers, eq(authUsers.id, approvals.decidedByUserId))
        .where(
          and(
            eq(issueApprovals.companyId, companyId),
            inArray(issueApprovals.issueId, issueIds),
            eq(approvals.status, "approved"),
          ),
        )
        .orderBy(desc(approvals.decidedAt));
      for (const row of approvalRows) {
        if (verifiedBy.has(row.issueId) || !row.decidedByUserId) continue;
        verifiedBy.set(row.issueId, {
          kind: "user",
          id: row.decidedByUserId,
          name: row.name ?? row.decidedByUserId,
        });
      }

      for (const row of page) {
        if (row.assigneeUserId && userNames.has(row.assigneeUserId)) {
          doneByUser.set(row.assigneeUserId, userNames.get(row.assigneeUserId)!);
        }
      }
    }

    const deliverables: CompanyDeliverable[] = page.map((row) => ({
      id: row.deliverableId ?? row.issueId,
      summary: row.summary ?? null,
      generationStatus: (row.generationStatus as CompanyDeliverable["generationStatus"] | null) ?? "pending",
      issue: {
        id: row.issueId,
        identifier: row.identifier ?? "",
        title: row.title,
      },
      project: row.projectId ? { id: row.projectId, name: row.projectName ?? "" } : null,
      product: productsByIssue.get(row.issueId) ?? null,
      doneBy: row.assigneeAgentId
        ? { kind: "agent", id: row.assigneeAgentId, name: doneByAgent.get(row.assigneeAgentId) ?? "Agent" }
        : row.assigneeUserId
          ? { kind: "user", id: row.assigneeUserId, name: doneByUser.get(row.assigneeUserId) ?? row.assigneeUserId }
          : null,
      verifiedBy: verifiedBy.get(row.issueId) ?? null,
      completedAt: (row.completedAt as Date).toISOString(),
    }));

    return { deliverables, nextCursor };
  }

  return { list };
}
