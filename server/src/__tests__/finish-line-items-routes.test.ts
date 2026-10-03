import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  finishLineItems,
  issues,
  principalPermissionGrants,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { finishLineItemRoutes } from "../routes/finish-line-items.js";
import { issueRoutes } from "../routes/issues.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres finish-line item tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

/**
 * Finish-line contract (Benn's end-goal feature, Oct 3): every project can
 * carry a bullet list of "what done looks like"; tasks tag the bullet they
 * serve. Delete refuses while a task still references the item; tags must
 * stay inside one project; every mutation is activity-logged and
 * company-scoped.
 */
describeEmbeddedPostgres("finish-line item routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-finish-line-items-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(finishLineItems);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(principalPermissionGrants);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyId: string, actor?: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor ?? {
        type: "board",
        userId: "cloud-user-1",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", finishLineItemRoutes(db));
    app.use("/api", issueRoutes(db, {} as any, { taskWatchdogEnqueueWakeup: null }));
    app.use(errorHandler);
    return app;
  }

  function uniqueIssuePrefix() {
    return `F${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  }

  async function seedCompany(name = "Finish line co") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: uniqueIssuePrefix(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "cloud-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: "cloud-user-1",
      membershipRole: "owner",
      grantedByUserId: null,
    });
    return companyId;
  }

  async function seedProject(companyId: string, name: string) {
    const id = randomUUID();
    await db.insert(projects).values({ id, companyId, name, status: "in_progress" });
    return id;
  }

  it("CRUD round-trip with position-then-creation ordering", async () => {
    const companyId = await seedCompany();
    const projectId = await seedProject(companyId, "Books & Taxes");
    const app = createApp(companyId);

    const base = `/api/companies/${companyId}/projects/${projectId}/finish-line-items`;

    const first = await request(app)
      .post(base)
      .send({ title: "Quarterly estimated taxes paid on time", position: 1 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(base)
      .send({ title: "Every account reconciles monthly", position: 0, description: "Bofa + Amex + PayPal via QBO" });
    expect(second.status).toBe(201);

    const list = await request(app).get(base);
    expect(list.status).toBe(200);
    expect(list.body.map((item: { title: string }) => item.title)).toEqual([
      "Every account reconciles monthly",
      "Quarterly estimated taxes paid on time",
    ]);

    const patch = await request(app)
      .patch(`/api/companies/${companyId}/finish-line-items/${second.body.id}`)
      .send({ status: "done" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("done");

    const after = await request(app).get(base);
    expect(after.body.find((item: { id: string }) => item.id === second.body.id).status).toBe("done");
  });

  it("tasks tag a finish-line item; null clears the tag", async () => {
    const companyId = await seedCompany();
    const projectId = await seedProject(companyId, "Tagged project");
    const app = createApp(companyId);

    const item = await request(app)
      .post(`/api/companies/${companyId}/projects/${projectId}/finish-line-items`)
      .send({ title: "Reconcile all accounts" });
    expect(item.status).toBe(201);

    const created = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Reconcile October", projectId, finishLineItemId: item.body.id });
    expect(created.status).toBe(201);
    expect(created.body.finishLineItemId).toBe(item.body.id);

    const cleared = await request(app)
      .patch(`/api/issues/${created.body.id}`)
      .send({ finishLineItemId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.finishLineItemId).toBeNull();
  });

  it("list nests exactly each bullet's tagged tasks, non-done first", async () => {
    const companyId = await seedCompany();
    const projectId = await seedProject(companyId, "Nested tasks project");
    const app = createApp(companyId);
    const base = `/api/companies/${companyId}/projects/${projectId}/finish-line-items`;

    const tagged = await request(app).post(base).send({ title: "Close the books" });
    expect(tagged.status).toBe(201);
    const untagged = await request(app).post(base).send({ title: "Hire a bookkeeper" });
    expect(untagged.status).toBe(201);

    // Two tasks tag the bullet (one done, one in progress); one bystander
    // stays untagged. Inserted directly so statuses are exact.
    const taggedDoneId = randomUUID();
    const taggedActiveId = randomUUID();
    const bystanderId = randomUUID();
    await db.insert(issues).values([
      {
        id: taggedDoneId,
        companyId,
        projectId,
        title: "Reconcile October",
        status: "done",
        finishLineItemId: tagged.body.id,
      },
      {
        id: taggedActiveId,
        companyId,
        projectId,
        title: "Wire the QBO feed",
        status: "in_progress",
        finishLineItemId: tagged.body.id,
      },
      {
        id: bystanderId,
        companyId,
        projectId,
        title: "Refactor the login page",
        status: "in_progress",
      },
    ]);

    const list = await request(app).get(base);
    expect(list.status).toBe(200);

    // The bullet carries exactly its two tagged tasks.
    const bullet = list.body.find((item: { id: string }) => item.id === tagged.body.id);
    expect(bullet.tasks).toHaveLength(2);
    expect(new Set(bullet.tasks.map((task: { id: string }) => task.id))).toEqual(
      new Set([taggedDoneId, taggedActiveId]),
    );
    // The untagged task appears nowhere in the response.
    expect(JSON.stringify(list.body)).not.toContain(bystanderId);
    // Non-done first (the live work), done after (the record of what got it done).
    expect(bullet.tasks.map((task: { status: string }) => task.status)).toEqual([
      "in_progress",
      "done",
    ]);
    // Compact projection: nothing beyond id/title/status rides along.
    for (const task of bullet.tasks) {
      expect(Object.keys(task).sort()).toEqual(["id", "status", "title"]);
    }

    // Untagged bullets carry an empty task list, consistently.
    const quiet = list.body.find((item: { id: string }) => item.id === untagged.body.id);
    expect(quiet.tasks).toEqual([]);
  });

  it("rejects tagging an item from a different project", async () => {
    const companyId = await seedCompany();
    const projectA = await seedProject(companyId, "Project A");
    const projectB = await seedProject(companyId, "Project B");
    const app = createApp(companyId);

    const item = await request(app)
      .post(`/api/companies/${companyId}/projects/${projectA}/finish-line-items`)
      .send({ title: "Belongs to A" });
    expect(item.status).toBe(201);

    const created = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Task in B", projectId: projectB, finishLineItemId: item.body.id });
    expect(created.status).toBe(400);
  });

  it("delete refuses while a task references the item, succeeds after", async () => {
    const companyId = await seedCompany();
    const projectId = await seedProject(companyId, "Referenced project");
    const app = createApp(companyId);

    const item = await request(app)
      .post(`/api/companies/${companyId}/projects/${projectId}/finish-line-items`)
      .send({ title: "Referenced bullet" });
    const issue = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Tagged task", projectId, finishLineItemId: item.body.id });
    expect(issue.status).toBe(201);

    const blocked = await request(app).delete(
      `/api/companies/${companyId}/finish-line-items/${item.body.id}`,
    );
    expect(blocked.status).toBe(409);

    await request(app).patch(`/api/issues/${issue.body.id}`).send({ finishLineItemId: null });

    const freed = await request(app).delete(
      `/api/companies/${companyId}/finish-line-items/${item.body.id}`,
    );
    expect(freed.status).toBe(200);
  });

  it("mutations are activity-logged as finish_line_item", async () => {
    const companyId = await seedCompany();
    const projectId = await seedProject(companyId, "Logged project");
    const app = createApp(companyId);

    const item = await request(app)
      .post(`/api/companies/${companyId}/projects/${projectId}/finish-line-items`)
      .send({ title: "Logged bullet" });
    expect(item.status).toBe(201);

    const rows = await db.select().from(activityLog);
    const goals = rows.filter((row) => row.entityType === "finish_line_item");
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0].entityId).toBe(item.body.id);
  });

  it("other companies' items are unreachable", async () => {
    const companyA = await seedCompany("Company A");
    const companyB = await seedCompany("Company B");
    const projectA = await seedProject(companyA, "A project");
    const appB = createApp(companyB);

    const item = await request(appB)
      .post(`/api/companies/${companyA}/projects/${projectA}/finish-line-items`)
      .send({ title: "A's bullet" });
    // B's actor has no access to company A: every route must refuse.
    expect([403, 404]).toContain(item.status);

    const listed = await request(appB).get(
      `/api/companies/${companyB}/projects/${projectA}/finish-line-items`,
    );
    expect(listed.status).toBe(404);
  });
});
