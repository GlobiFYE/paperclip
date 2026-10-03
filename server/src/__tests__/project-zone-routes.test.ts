import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, companies, createDb, projects } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project zone tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

function boardActor(companyIds: string[]): Express.Request["actor"] {
  return {
    type: "board",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: true,
    companyIds,
    memberships: companyIds.map((companyId) => ({
      companyId,
      membershipRole: "admin",
      status: "active",
    })),
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("project zone routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-project-zones-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    // POST/PATCH routes persist activity-log rows that reference the seeded
    // company, so clear them before the parent deletes (repo convention).
    await db.delete(activityLog);
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
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedProject(companyId: string, name: string) {
    const id = randomUUID();
    await db.insert(projects).values({ id, companyId, name, status: "in_progress" });
    return id;
  }

  async function readZone(projectId: string): Promise<string | undefined> {
    const [row] = await db
      .select({ zone: projects.zone })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row?.zone;
  }

  async function readLotState(projectId: string): Promise<string | null | undefined> {
    const [row] = await db
      .select({ lot_state: projects.lot_state })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row?.lot_state;
  }

  async function armLimit(limit: number) {
    // updateExperimental invalidates the per-call-site setting cache, so the
    // next demote call reads the new limit immediately.
    await instanceSettingsService(db).updateExperimental({ focusLaneProjectLimit: limit });
  }

  async function seedUpdatedAt(projectId: string, updatedAt: Date) {
    await db.update(projects).set({ updatedAt }).where(eq(projects.id, projectId));
  }

  async function listZoneB(companyId: string): Promise<string[]> {
    const rows = await db
      .select({ id: projects.id, zone: projects.zone })
      .from(projects)
      .where(eq(projects.companyId, companyId));
    return rows.filter((row) => row.zone === "b").map((row) => row.id);
  }

  it("creates projects in zone a by default", async () => {
    const companyId = await seedCompany("Default zone co");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).post(`/api/companies/${companyId}/projects`).send({ name: "Parked idea" });

    expect(res.status).toBe(201);
    expect(res.body.zone).toBe("a");
    expect(await readZone(res.body.id)).toBe("a");
  });

  it("promotes a project to zone b via PATCH", async () => {
    const companyId = await seedCompany("Promote co");
    const projectId = await seedProject(companyId, "Active lane");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).patch(`/api/projects/${projectId}`).send({ zone: "b" });

    expect(res.status).toBe(200);
    expect(res.body.zone).toBe("b");
    expect(await readZone(projectId)).toBe("b");
  });

  it("demotes the previous zone-b project when another takes the active lane", async () => {
    const companyId = await seedCompany("Takeover co");
    const firstId = await seedProject(companyId, "First active");
    const secondId = await seedProject(companyId, "Second active");
    const app = createApp(db, boardActor([companyId]));

    const promote = await request(app).patch(`/api/projects/${firstId}`).send({ zone: "b" });
    expect(promote.status).toBe(200);

    const takeover = await request(app).patch(`/api/projects/${secondId}`).send({ zone: "b" });

    expect(takeover.status).toBe(200);
    expect(takeover.body.zone).toBe("b");
    expect(await readZone(secondId)).toBe("b");
    expect(await readZone(firstId)).toBe("a");
  });

  it("rejects an invalid zone with 400 and leaves the zone untouched", async () => {
    const companyId = await seedCompany("Invalid zone co");
    const projectId = await seedProject(companyId, "Bad zone input");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).patch(`/api/projects/${projectId}`).send({ zone: "c" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(await readZone(projectId)).toBe("a");
  });

  it("demotes only same-company projects; other companies keep their active lane", async () => {
    const companyA = await seedCompany("Alpha co");
    const companyB = await seedCompany("Beta co");
    const aActiveId = await seedProject(companyA, "Alpha active");
    const aOtherId = await seedProject(companyA, "Alpha parked");
    const bActiveId = await seedProject(companyB, "Beta active");
    const app = createApp(db, boardActor([companyA, companyB]));

    await request(app).patch(`/api/projects/${aActiveId}`).send({ zone: "b" });

    // Beta takes its own active lane; Alpha's zone-b project must survive.
    const betaPromote = await request(app).patch(`/api/projects/${bActiveId}`).send({ zone: "b" });
    expect(betaPromote.status).toBe(200);
    expect(await readZone(bActiveId)).toBe("b");
    expect(await readZone(aActiveId)).toBe("b");
    expect(await readZone(aOtherId)).toBe("a");

    // Alpha's parked project takes over Alpha's lane: demote stays inside Alpha.
    const alphaTakeover = await request(app).patch(`/api/projects/${aOtherId}`).send({ zone: "b" });
    expect(alphaTakeover.status).toBe(200);
    expect(await readZone(aOtherId)).toBe("b");
    expect(await readZone(aActiveId)).toBe("a");
    expect(await readZone(bActiveId)).toBe("b");
  });

  it("creates projects with an untouched (null) lot state", async () => {
    const companyId = await seedCompany("Default lot co");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).post(`/api/companies/${companyId}/projects`).send({ name: "Fresh lot idea" });

    expect(res.status).toBe(201);
    expect(res.body.lot_state).toBeNull();
    expect(await readLotState(res.body.id)).toBeNull();
  });

  it("sets the night-crew lot state via PATCH and round-trips it", async () => {
    const companyId = await seedCompany("Lot ready co");
    const projectId = await seedProject(companyId, "Worked idea");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).patch(`/api/projects/${projectId}`).send({ lot_state: "ready" });

    expect(res.status).toBe(200);
    expect(res.body.lot_state).toBe("ready");
    expect(await readLotState(projectId)).toBe("ready");
  });

  it("clears the lot state with an explicit null PATCH", async () => {
    const companyId = await seedCompany("Lot clear co");
    const projectId = await seedProject(companyId, "Cleared idea");
    const app = createApp(db, boardActor([companyId]));

    const set = await request(app).patch(`/api/projects/${projectId}`).send({ lot_state: "built" });
    expect(set.status).toBe(200);
    expect(await readLotState(projectId)).toBe("built");

    const clear = await request(app).patch(`/api/projects/${projectId}`).send({ lot_state: null });

    expect(clear.status).toBe(200);
    expect(clear.body.lot_state).toBeNull();
    expect(await readLotState(projectId)).toBeNull();
  });

  it("rejects an invalid lot state with 400 and leaves the column null", async () => {
    const companyId = await seedCompany("Invalid lot co");
    const projectId = await seedProject(companyId, "Bad lot input");
    const app = createApp(db, boardActor([companyId]));

    const res = await request(app).patch(`/api/projects/${projectId}`).send({ lot_state: "wat" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(await readLotState(projectId)).toBeNull();
  });

  it("holds three zone-b projects together when focusLaneProjectLimit is 3", async () => {
    await armLimit(3);
    const companyId = await seedCompany("Multi-lane co");
    const firstId = await seedProject(companyId, "Lane one");
    const secondId = await seedProject(companyId, "Lane two");
    const thirdId = await seedProject(companyId, "Lane three");
    const app = createApp(db, boardActor([companyId]));

    for (const id of [firstId, secondId, thirdId]) {
      const res = await request(app).patch(`/api/projects/${id}`).send({ zone: "b" });
      expect(res.status).toBe(200);
      expect(res.body.zone).toBe("b");
    }

    expect((await listZoneB(companyId)).sort()).toEqual([firstId, secondId, thirdId].sort());
  });

  it("demotes the least-recently-updated zone-b project when a 4th takes a lane at limit 3", async () => {
    await armLimit(3);
    const companyId = await seedCompany("Lane eviction co");
    const oldestId = await seedProject(companyId, "Stalest lane");
    const middleId = await seedProject(companyId, "Middle lane");
    const newestId = await seedProject(companyId, "Fresh lane");
    const fourthId = await seedProject(companyId, "Incoming lane");
    const app = createApp(db, boardActor([companyId]));

    for (const id of [oldestId, middleId, newestId]) {
      await request(app).patch(`/api/projects/${id}`).send({ zone: "b" });
    }
    // Seed explicit updatedAt ordering: oldest < middle < newest.
    await seedUpdatedAt(oldestId, new Date("2026-09-01T00:00:00Z"));
    await seedUpdatedAt(middleId, new Date("2026-09-02T00:00:00Z"));
    await seedUpdatedAt(newestId, new Date("2026-09-03T00:00:00Z"));

    const takeover = await request(app).patch(`/api/projects/${fourthId}`).send({ zone: "b" });

    expect(takeover.status).toBe(200);
    expect(takeover.body.zone).toBe("b");
    // The post-op zone-b set is exactly the limit: the newcomer plus the two
    // most-recently-updated incumbents; the stalest one is demoted.
    expect((await listZoneB(companyId)).sort()).toEqual([fourthId, middleId, newestId].sort());
    expect(await readZone(oldestId)).toBe("a");
  });

  it("applies the same limit rule when creating directly in zone b", async () => {
    await armLimit(3);
    const companyId = await seedCompany("Create-in-b co");
    const oldestId = await seedProject(companyId, "Stalest lane");
    const middleId = await seedProject(companyId, "Middle lane");
    const newestId = await seedProject(companyId, "Fresh lane");
    const app = createApp(db, boardActor([companyId]));

    for (const id of [oldestId, middleId, newestId]) {
      await request(app).patch(`/api/projects/${id}`).send({ zone: "b" });
    }
    await seedUpdatedAt(oldestId, new Date("2026-09-01T00:00:00Z"));
    await seedUpdatedAt(middleId, new Date("2026-09-02T00:00:00Z"));
    await seedUpdatedAt(newestId, new Date("2026-09-03T00:00:00Z"));

    const res = await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "Born in the lane", zone: "b" });

    expect(res.status).toBe(201);
    expect(res.body.zone).toBe("b");
    expect((await listZoneB(companyId)).sort()).toEqual([res.body.id, middleId, newestId].sort());
    expect(await readZone(oldestId)).toBe("a");
  });
});
