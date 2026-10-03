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
import { dashboardService } from "../services/dashboard.js";
import { instanceSettingsService } from "../services/instance-settings.js";

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
 * Night-crew focus dashboard contract (doc/plans/2026-10-02-night-crew.md §2b
 * + the Oct 3 multi-lane follow-up): the dashboard is the active-lane HQ —
 * the company's zone-"b" projects (as many as the owner's
 * focusLaneProjectLimit allows, default 1) each get a lane with their own
 * next steps (in_progress first), nested pending one-tap questions, and only
 * the lane's own activity. Zero lot content, zero other projects, zero
 * metrics. These tests call the service directly (same convention as the
 * zone-visibility suite) — the route is a thin auth wrapper around it.
 */
describeEmbeddedPostgres("focus dashboard contract", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-focus-dashboard-");
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

  /** Arm the ADHD-edition lane-limit setting (default off = 1 lane). */
  async function armLaneLimit(limit: number) {
    await instanceSettingsService(db).updateExperimental({ focusLaneProjectLimit: limit });
  }

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
    options: { archivedAt?: Date; updatedAt?: Date } = {},
  ) {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      companyId,
      name,
      status: "in_progress",
      zone,
      ...(options.archivedAt ? { archivedAt: options.archivedAt } : {}),
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
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

  /** Insert a pending ask_user_questions card on an issue. */
  async function seedQuestionCard(
    companyId: string,
    issueId: string,
    questions: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>,
    options: { status?: string; kind?: string } = {},
  ) {
    const id = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id,
      companyId,
      issueId,
      kind: options.kind ?? "ask_user_questions",
      status: options.status ?? "pending",
      payload: {
        version: 1,
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          selectionMode: "single",
          options: question.options,
        })),
      },
    });
    return id;
  }

  it("returns the zone-b project as a lane with in_progress next steps first", async () => {
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

    expect(focus.lanes).toHaveLength(1);
    const lane = focus.lanes[0];
    expect(lane.project.id).toBe(laneProjectId);
    expect(lane.project.name).toBe("Active lane");
    expect(lane.project.status).toBe("in_progress");

    const stepTitles = lane.nextSteps.map((step) => step.title);
    expect(stepTitles).toEqual(["Ship the lane", "Queue the follow-up"]);
    expect(lane.nextSteps.map((step) => step.id)).toEqual([inProgressId, todoId]);
  });

  it("default limit 1: only the most recently updated zone-b project becomes the lane", async () => {
    const companyId = await seedCompany("Single lane co");
    const olderLaneId = await seedProject(companyId, "Older lane", "b", {
      updatedAt: new Date("2026-09-28T12:00:00Z"),
    });
    const newerLaneId = await seedProject(companyId, "Newer lane", "b", {
      updatedAt: new Date("2026-10-03T12:00:00Z"),
    });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.lanes).toHaveLength(1);
    expect(focus.lanes[0].project.id).toBe(newerLaneId);
    expect(focus.lanes.map((lane) => lane.project.id)).not.toContain(olderLaneId);
  });

  it("armed limit 3: up to three zone-b projects each get their own lane", async () => {
    await armLaneLimit(3);
    const companyId = await seedCompany("Multi lane co");
    const firstId = await seedProject(companyId, "Lane one", "b", {
      updatedAt: new Date("2026-10-01T12:00:00Z"),
    });
    const secondId = await seedProject(companyId, "Lane two", "b", {
      updatedAt: new Date("2026-10-02T12:00:00Z"),
    });
    const thirdId = await seedProject(companyId, "Lane three", "b", {
      updatedAt: new Date("2026-10-03T12:00:00Z"),
    });
    const lotProjectId = await seedProject(companyId, "Parked lot", "a", {
      updatedAt: new Date("2026-10-04T12:00:00Z"),
    });

    await seedIssue(companyId, firstId, "Lane one task", { status: "in_progress" });
    await seedIssue(companyId, secondId, "Lane two task", { status: "todo" });
    await seedIssue(companyId, lotProjectId, "Parked task", { status: "todo" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.lanes).toHaveLength(3);
    // Ordered most-recently-updated first.
    expect(focus.lanes.map((lane) => lane.project.id)).toEqual([thirdId, secondId, firstId]);
    // Each lane carries only its own next steps.
    expect(focus.lanes[2].nextSteps.map((step) => step.title)).toEqual(["Lane one task"]);
    expect(focus.lanes[1].nextSteps.map((step) => step.title)).toEqual(["Lane two task"]);
    expect(focus.lanes[0].nextSteps).toEqual([]);
  });

  it("excludes archived zone-b projects from the lanes", async () => {
    const companyId = await seedCompany("Archived lane co");
    const archivedProjectId = await seedProject(companyId, "Archived lane", "b", {
      archivedAt: new Date("2026-09-30T00:00:00Z"),
    });
    await seedIssue(companyId, archivedProjectId, "Zombie task", { status: "todo" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.lanes).toEqual([]);
  });

  it("returns an empty surface when the company has no zone-b project", async () => {
    const companyId = await seedCompany("No lane co");
    const lotProjectId = await seedProject(companyId, "Parked lot", "a");
    await seedIssue(companyId, lotProjectId, "Parked task", { status: "todo" });

    const focus = await dashboardService(db).focus(companyId);

    expect(focus.lanes).toEqual([]);
  });

  it("nests pending one-tap questions under their next-step task only, capped at 3", async () => {
    const companyId = await seedCompany("Questions lane co");
    const laneProjectId = await seedProject(companyId, "Active lane", "b");
    const stepIssueId = await seedIssue(companyId, laneProjectId, "Pick the motor", {
      status: "in_progress",
    });
    const doneIssueId = await seedIssue(companyId, laneProjectId, "Already shipped", {
      status: "done",
    });

    // A pending card on the next-step task: 4 questions in the card, only 3 surface.
    await seedQuestionCard(companyId, stepIssueId, [
      { id: "q1", prompt: "Which motor: A or B?", options: [{ id: "a", label: "12mm" }, { id: "b", label: "25mm" }] },
      { id: "q2", prompt: "Which color?", options: [{ id: "black", label: "Black" }] },
      { id: "q3", prompt: "Which finish?", options: [{ id: "matte", label: "Matte" }] },
      { id: "q4", prompt: "Which vendor?", options: [{ id: "jlc", label: "JLC" }] },
    ]);
    // A RESOLVED card on the same task: never surfaces.
    await seedQuestionCard(
      companyId,
      stepIssueId,
      [{ id: "r1", prompt: "Already answered?", options: [{ id: "y", label: "Yes" }] }],
      { status: "resolved" },
    );
    // A pending card on a non-next-step (done) issue: never surfaces.
    await seedQuestionCard(
      companyId,
      doneIssueId,
      [{ id: "d1", prompt: "Done question?", options: [{ id: "x", label: "X" }] }],
    );

    const focus = await dashboardService(db).focus(companyId);

    const step = focus.lanes[0].nextSteps.find((s) => s.id === stepIssueId);
    expect(step).toBeDefined();
    expect(step!.questions).toHaveLength(3);
    expect(step!.questions[0]).toMatchObject({
      questionId: "q1",
      prompt: "Which motor: A or B?",
      options: [
        { id: "a", label: "12mm" },
        { id: "b", label: "25mm" },
      ],
    });
    // Capped: the 4th card question never surfaces.
    expect(step!.questions.map((q) => q.questionId)).toEqual(["q1", "q2", "q3"]);
    // The resolved prompt never surfaces.
    expect(step!.questions.map((q) => q.prompt)).not.toContain("Already answered?");
    // The done issue never surfaces as a step or a question host.
    expect(focus.lanes[0].nextSteps.map((s) => s.id)).not.toContain(doneIssueId);
  });

  it("scopes laneActivity to each lane project's own events only", async () => {
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

    const entityKeys = focus.lanes[0].laneActivity.map((row) => `${row.entityType}:${row.entityId}`);
    expect(entityKeys).toContain(`project:${laneProjectId}`);
    expect(entityKeys).toContain(`issue:${laneIssueId}`);
    expect(entityKeys).not.toContain(`project:${otherProjectId}`);
    expect(entityKeys).not.toContain(`issue:${otherIssueId}`);
  });
});
