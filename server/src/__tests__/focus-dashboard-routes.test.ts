import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { dashboardService } from "../services/dashboard.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres focus dashboard tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

/**
 * Night-crew focus dashboard contract (doc/plans/2026-10-02-night-crew.md §2b):
 * the dashboard is the active-lane HQ — the company's single zone-"b" project
 * front and center, its next steps with in_progress first, and only the lane's
 * own activity. Zero lot content, zero other projects, zero metrics. These
 * tests call the service directly (same convention as the zone-visibility
 * suite) — the route is a thin auth wrapper around it.
 */
describeEmbeddedPostgres("focus dashboard contract", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-focus-dashboard-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `F${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedProject(
    companyId: string,
    name: string,
    zone: "a" | "b",
    options: { archivedAt?: Date } = {},
  ) {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      companyId,
      name,
      status: "in_progress",
      zone,
      ...(options.archivedAt ? { archivedAt: options.archivedAt } : {}),
    });
    return id;
  }

  async function seedIssue(
    companyId: string,
    projectId: string,
    title: string,
    options: { status?: string; updatedAt?: Date } = {},
  ) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      projectId,
      title,
      status: options.status ?? "in_progress",
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
    });
    return id;
  }

  async function seedActivity(companyId: string, entityType: string, entityId: string, action: string) {
    await db.insert(activityLog).values({
      companyId,
      actorType: "system",
      actorId: "test",
      action,
      entityType,
      entityId,
    });
  }

  it("returns the zone-b project as the active lane with in_progress next steps first", async () => {
    const companyId = await seedCompany("Focus lane co");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const lotProjectId = await seedProject(companyId, "Parked lot", "a");

    // The todo item is touched LAST: if the ordering were plain updatedAt-desc,
    // it would lead. The in_progress bucket must win regardless.
    const inProgressId = await seedIssue(companyId, laneProjectId, "Ship the lane", {
      status: "in_progress",
      updatedAt: new Date("2026-10-01T12:00:00Z"),
    });
    const todoId = await seedIssue(companyId, laneProjectId, "Queue the follow-up", {
      status: "todo",
      updatedAt: new Date("2026-10-02T12:00:00Z"),
    });
    // Lot work and done work never surface as next steps.
    await seedIssue(companyId, lotProjectId, "Parked lot task", { status: "todo" });
    await seedIssue(companyId, laneProjectId, "Already shipped", { status: "done" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.activeProject).not.toBeNull();
    expect(focus.activeProject!.id).toBe(laneProjectId);
    expect(focus.activeProject!.name).toBe("Active lane");
    expect(focus.activeProject!.status).toBe("in_progress");

    const stepTitles = focus.nextSteps.map((step) => step.title);
    expect(stepTitles).toEqual(["Ship the lane", "Queue the follow-up"]);
    expect(focus.nextSteps.map((step) => step.id)).toEqual([inProgressId, todoId]);
  });

  it("excludes archived zone-b projects from the active lane", async () => {
    const companyId = await seedCompany("Archived lane co");
    const archivedProjectId = await seedProject(companyId, "Archived lane", "b", {
      archivedAt: new Date("2026-09-30T00:00:00Z"),
    });
    await seedIssue(companyId, archivedProjectId, "Zombie task", { status: "todo" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.activeProject).toBeNull();
    expect(focus.nextSteps).toEqual([]);
    expect(focus.laneActivity).toEqual([]);
  });

  it("returns an empty surface when the company has no zone-b project", async () => {
    const companyId = await seedCompany("No lane co");
    const lotProjectId = await seedProject(companyId, "Parked lot", "a");
    await seedIssue(companyId, lotProjectId, "Parked task", { status: "todo" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.activeProject).toBeNull();
    expect(focus.nextSteps).toEqual([]);
    expect(focus.laneActivity).toEqual([]);
  });

  it("scopes laneActivity to the lane project's own events only", async () => {
    const companyId = await seedCompany("Lane activity co");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const otherProjectId = await seedProject(companyId, "Other project", "a");
    const laneIssueId = await seedIssue(companyId, laneProjectId, "Lane task");
    const otherIssueId = await seedIssue(companyId, otherProjectId, "Other task");

    await seedActivity(companyId, "project", laneProjectId, "project.updated");
    await seedActivity(companyId, "issue", laneIssueId, "issue.created");
    await seedActivity(companyId, "project", otherProjectId, "project.updated");
    await seedActivity(companyId, "issue", otherIssueId, "issue.created");

    const focus = await dashboardService(db).focus(companyId);

    const entityKeys = focus.laneActivity.map((row) => `${row.entityType}:${row.entityId}`);
    expect(entityKeys).toContain(`project:${laneProjectId}`);
    expect(entityKeys).toContain(`issue:${laneIssueId}`);
    expect(entityKeys).not.toContain(`project:${otherProjectId}`);
    expect(entityKeys).not.toContain(`issue:${otherIssueId}`);
  });
});
