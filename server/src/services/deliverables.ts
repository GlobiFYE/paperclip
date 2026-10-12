import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { agents, authUsers, issueDeliverables, issues, projects, type Db } from "@paperclipai/db";
import { COMPANY_DELIVERABLES_MAX_LIMIT, type CompanyDeliverable, type CompanyDeliverablesQuery, type CompanyDeliverablesResponse } from "@paperclipai/shared";
import { badRequest } from "../errors.js";
import { deliverableGenerationState, resolveDeliverableSummaryModelConfig } from "./deliverable-summary.js";
import { deliverableDoneBy, deliverableVerifier, readDeliverableSources, resolveDeliverableProducts } from "./deliverable-source.js";

function decodeCursor(cursor?: string): { id: string; completedAt: string } | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) || !Number.isFinite(Date.parse(value.completedAt))) throw new Error();
    return value;
  } catch { throw badRequest("Invalid deliverables cursor"); }
}
function dateBound(value?: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) throw badRequest("Invalid completion date");
  return new Date(value);
}

export function deliverablesService(db: Db) {
  return { async list(companyId: string, query: CompanyDeliverablesQuery): Promise<CompanyDeliverablesResponse> {
    const cursor = decodeCursor(query.cursor);
    const from = dateBound(query.from), to = dateBound(query.to);
    if (from && to && from >= to) throw badRequest("Completion date range must end after it starts");
    const limit = Math.min(Math.max(query.limit ?? 30, 1), COMPANY_DELIVERABLES_MAX_LIMIT);
    // Old imported completions may not have completedAt.
    const completion = sql<Date>`date_trunc('milliseconds', coalesce(${issues.completedAt}, ${issues.updatedAt}))`.mapWith(issues.updatedAt);
    const conditions: (SQL | undefined)[] = [eq(issues.companyId, companyId), eq(issues.status, "done"), isNull(issues.hiddenAt)];
    if (query.projectId) conditions.push(eq(issues.projectId, query.projectId));
    if (from) conditions.push(gte(completion, from.toISOString()));
    if (to) conditions.push(lt(completion, to.toISOString()));
    if (cursor) conditions.push(or(lt(completion, cursor.completedAt), and(eq(completion, cursor.completedAt), lt(issues.id, cursor.id))));
    const rows = await db.select({ issue: issues, deliverable: issueDeliverables, projectName: projects.name, completedAt: completion })
      .from(issues).leftJoin(issueDeliverables, and(eq(issueDeliverables.issueId, issues.id), eq(issueDeliverables.companyId, companyId)))
      .leftJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.companyId, companyId)))
      .where(and(...conditions)).orderBy(desc(completion), desc(issues.id)).limit(limit + 1);
    const page = rows.slice(0, limit);
    const sources = await readDeliverableSources(db, companyId, page.map(r => r.issue.id));
    const agentIds = new Set<string>(), userIds = new Set<string>();
    for (const { issue } of page) {
      const source = sources.get(issue.id);
      if (!source) continue;
      const doneBy = deliverableDoneBy(source);
      if (doneBy?.kind === "agent") agentIds.add(doneBy.id);
      if (doneBy?.kind === "user") userIds.add(doneBy.id);
      const verifier = deliverableVerifier(source);
      if (verifier) agentIds.add(verifier);
    }
    const [agentRows, userRows] = await Promise.all([
      agentIds.size ? db.select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, [...agentIds]))) : [],
      userIds.size ? db.select({ id: authUsers.id, name: authUsers.name }).from(authUsers).where(inArray(authUsers.id, [...userIds])) : [],
    ]);
    const agentNames = new Map(agentRows.map(a => [a.id, a.name]));
    const userNames = new Map(userRows.map(a => [a.id, a.name]));
    const deliverables: CompanyDeliverable[] = page.flatMap(row => {
      const source = sources.get(row.issue.id);
      if (!source || source.issue.status !== "done" || source.issue.hiddenAt) return [];
      const verifier = deliverableVerifier(source);
      const doneBy = deliverableDoneBy(source);
      const generationState = deliverableGenerationState(row.deliverable, source);
      return [{
        id: row.deliverable?.id ?? row.issue.id,
        summary: row.deliverable?.summary ?? null,
        generationState,
        nextAttemptAt: row.deliverable?.nextAttemptAt?.toISOString() ?? null,
        fallback: `${source.issue.title}${source.comments[0] ? `. ${source.comments[0].body.slice(0, 400)}` : ""}`,
        summaryFromTaskDetails: row.deliverable?.summaryFromTaskDetails ?? source.comments.length === 0,
        issue: { id: source.issue.id, identifier: source.issue.identifier ?? "", title: source.issue.title },
        project: source.issue.projectId ? { id: source.issue.projectId, name: row.projectName ?? "Project" } : null,
        product: resolveDeliverableProducts(source)[0] ?? null,
        doneBy: doneBy ? { ...doneBy, name: doneBy.kind === "agent"
          ? agentNames.get(doneBy.id) ?? "Agent" : userNames.get(doneBy.id) ?? "User" } : null,
        verifiedBy: verifier ? { kind: "agent", id: verifier, name: agentNames.get(verifier) ?? "Agent" } : null,
        completedAt: row.completedAt.toISOString(),
      }];
    });
    const last = page.at(-1);
    return { summariesEnabled: Boolean(await resolveDeliverableSummaryModelConfig()), deliverables, nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ id: last.issue.id, completedAt: last.completedAt.toISOString() })).toString("base64url") : null };
  } };
}
