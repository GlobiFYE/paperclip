import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

// External scratch database (e.g. Mac-local brew postgres) for hosts where the
// embedded binary cannot start. Must be a dedicated empty database — never a
// staging/production database. Migrations are applied by the test itself.
const externalTestDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL?.trim() || null;

const embeddedPostgresSupport = externalTestDatabaseUrl
  ? { supported: true as const }
  : await getEmbeddedPostgresTestSupport();
const describeDb = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping atomic paused creation tests on this host: ${
      ("reason" in embeddedPostgresSupport && embeddedPostgresSupport.reason) ||
      "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;

function userActor(): Express.Request["actor"] {
  return { type: "board", userId: "local-board", source: "local_implicit" };
}

function createApp(db: Db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = userActor();
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

describeDb("atomic paused agent creation", () => {
  let db!: Db;
  let app!: ReturnType<typeof createApp>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `paperclip-atomic-paused-${randomUUID()}`);
  let companyId!: string;

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    tempDb = externalTestDatabaseUrl
      ? null
      : await startEmbeddedPostgresTestDatabase("paperclip-atomic-paused-");
    const connectionString = externalTestDatabaseUrl ?? tempDb!.connectionString;
    if (externalTestDatabaseUrl) {
      await applyPendingMigrations(connectionString);
    }
    db = createDb(connectionString);
    app = createApp(db);
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Atomic Paused Co",
      issuePrefix: "APC",
      requireBoardApprovalForNewAgents: false,
    });
  }, 120_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
    if (previousKeyFile === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  it("writes paused on first persist when initialPaused is set", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/agents`)
      .send({ name: "CTO", role: "cto", adapterType: "codex_local", initialPaused: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("paused");
    expect(res.body.pausedAt).not.toBeNull();

    const [row] = await db.select().from(agents).where(eq(agents.id, res.body.id));
    expect(row?.status).toBe("paused");
    expect(row?.pauseReason).toBe("created_paused");

    const runs = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, res.body.id));
    expect(runs).toHaveLength(0);
  });

  it("preserves historical idle creation without the flag", async () => {
    const res = await request(app)
      .post(`/api/companies/${companyId}/agents`)
      .send({ name: "Engineer", role: "engineer", adapterType: "codex_local" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("idle");
    expect(res.body.pausedAt).toBeNull();
  });
});
