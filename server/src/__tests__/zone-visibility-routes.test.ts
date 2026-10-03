import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  issueThreadInteractions,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { activityService } from "../services/activity.js";
import { attentionService } from "../services/attention.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres zone visibility tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

/**
 * Night-crew lot contract (doc/plans/2026-10-02-night-crew.md §1): an issue or
 * project parked in zone "a" (the lot) NEVER surfaces on attention surfaces.
 * These tests pin the server-side filters: company activity feed, the
 * company-wide issue list (with deliberate scopes as the escape hatch), and
 * the attention feed. Execution paths stay untouched on purpose.
 */
describeEmbeddedPostgres("zone visibility contract", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-zone-visibility-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issueThreadInteractions);
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
      issuePrefix: `Z${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedProject(companyId: string, name: string, zone: "a" | "b") {
    const id = randomUUID();
    await db.insert(projects).values({ id, companyId, name, status: "in_progress", zone });
    return id;
  }

  async function seedIssue(companyId: string, projectId: string, title: string) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      projectId,
      title,
      status: "in_progress",
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

  /**
   * ADHD-edition flag gate: arm or disarm the instance's enableLotView.
   * updateExperimental invalidates the per-call-site flag cache, so the next
   * service call sees the new value immediately.
   */
  async function armLotView(on: boolean) {
    await instanceSettingsService(db).updateExperimental({ enableLotView: on });
  }

  it("drops lot-project activity from the company feed while zone-b activity stays", async () => {
    await armLotView(true);
    const companyId = await seedCompany("Activity zone co");
    const lotProjectId = await seedProject(companyId, "Lot project", "a");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const lotIssueId = await seedIssue(companyId, lotProjectId, "Parked lot task");
    const laneIssueId = await seedIssue(companyId, laneProjectId, "Active lane task");

    await seedActivity(companyId, "issue", lotIssueId, "issue.created");
    await seedActivity(companyId, "issue", laneIssueId, "issue.created");
    await seedActivity(companyId, "project", lotProjectId, "project.updated");
    await seedActivity(companyId, "project", laneProjectId, "project.updated");

    const feed = await activityService(db).list({ companyId });

    const entityIds = feed.map((row) => `${row.entityType}:${row.entityId}`);
    expect(entityIds).toContain(`issue:${laneIssueId}`);
    expect(entityIds).toContain(`project:${laneProjectId}`);
    expect(entityIds).not.toContain(`issue:${lotIssueId}`);
    expect(entityIds).not.toContain(`project:${lotProjectId}`);
  });

  it("hides lot issues from the company-wide issue list but keeps deliberate scopes working", async () => {
    await armLotView(true);
    const companyId = await seedCompany("Issue zone co");
    const lotProjectId = await seedProject(companyId, "Lot project", "a");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const lotIssueId = await seedIssue(companyId, lotProjectId, "Parked lot task");
    const laneIssueId = await seedIssue(companyId, laneProjectId, "Active lane task");

    const svc = issueService(db);

    const companyWide = await svc.list(companyId);
    const companyWideIds = companyWide.map((issue) => issue.id);
    expect(companyWideIds).toContain(laneIssueId);
    expect(companyWideIds).not.toContain(lotIssueId);

    // A project walk (walk-the-lot) is deliberate access: lot issues show up.
    const lotScoped = await svc.list(companyId, { projectId: lotProjectId });
    expect(lotScoped.map((issue) => issue.id)).toContain(lotIssueId);

    // Text search is deliberate too: agents keep finding lot work by query.
    const searched = await svc.list(companyId, { q: "Parked lot task" });
    expect(searched.map((issue) => issue.id)).toContain(lotIssueId);
  });

  it("keeps lot-issue interactions out of the attention feed", async () => {
    await armLotView(true);
    const companyId = await seedCompany("Attention zone co");
    const lotProjectId = await seedProject(companyId, "Lot project", "a");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const lotIssueId = await seedIssue(companyId, lotProjectId, "Parked lot task");
    const laneIssueId = await seedIssue(companyId, laneProjectId, "Active lane task");

    const lotInteractionId = randomUUID();
    const laneInteractionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: lotInteractionId,
      companyId,
      issueId: lotIssueId,
      kind: "request_confirmation",
      status: "pending",
      payload: { version: 1, prompt: "Confirm the lot thing." },
    });
    await db.insert(issueThreadInteractions).values({
      id: laneInteractionId,
      companyId,
      issueId: laneIssueId,
      kind: "request_confirmation",
      status: "pending",
      payload: { version: 1, prompt: "Confirm the lane thing." },
    });

    const feed = await attentionService(db).list(companyId, { limit: 100 });
    const interactionIds = feed.items
      .filter((item) => item.sourceKind === "issue_thread_interaction")
      .map((item) => item.subject.id);

    expect(interactionIds).toContain(laneInteractionId);
    expect(interactionIds).not.toContain(lotInteractionId);
  });

  it("flag off: lot subjects surface everywhere again (classic upstream behavior)", async () => {
    // The ADHD-edition gate is default-off for a fresh instance; arm
    // explicitly so this test is order-independent of the armed ones above.
    await armLotView(false);
    const companyId = await seedCompany("Classic zone co");
    const lotProjectId = await seedProject(companyId, "Parked project", "a");
    const lotIssueId = await seedIssue(companyId, lotProjectId, "Parked task");

    await seedActivity(companyId, "issue", lotIssueId, "issue.created");
    await seedActivity(companyId, "project", lotProjectId, "project.updated");

    // Classic feed: lot activity shows (no filter applies).
    const feed = await activityService(db).list({ companyId });
    const entityIds = feed.map((row) => `${row.entityType}:${row.entityId}`);
    expect(entityIds).toContain(`issue:${lotIssueId}`);
    expect(entityIds).toContain(`project:${lotProjectId}`);

    // Classic issue list: lot issues show company-wide.
    const companyWide = await issueService(db).list(companyId);
    expect(companyWide.map((issue) => issue.id)).toContain(lotIssueId);
  });

  it("settings round-trip: enableLotView PATCHes are echoed and flip both ways", async () => {
    const settings = instanceSettingsService(db);

    await settings.updateExperimental({ enableLotView: true });
    let experimental = await settings.getExperimental();
    expect(experimental.enableLotView).toBe(true);

    await settings.updateExperimental({ enableLotView: false });
    experimental = await settings.getExperimental();
    expect(experimental.enableLotView).toBe(false);
  });
});
