import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentJwtRevocations,
  companies,
  createDb,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { cleanupAgentJwtRevocations, revokeAgentJwt } from "../services/agent-jwt-revocations.js";
import { deleteCompany } from "../services/company-deletion.js";

// These fixtures have no agents. Keep process lifecycle work outside this
// database regression and fail if deletion unexpectedly invokes it.
vi.mock("../services/agent-lifecycle.js", () => ({
  createAgentLifecycle: () => ({
    terminateAgent: () => { throw new Error("Unexpected agent termination"); },
  }),
  scheduleAgentLifecycle: () => { throw new Error("Unexpected lifecycle scheduling"); },
}));

describe("company deletion with retained JWT revocations", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "company-deletion-test");
    database = await startEmbeddedPostgresTestDatabase("company-deletion-revocations-");
    db = createDb(database.connectionString);
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
  });

  async function createCompany() {
    const [company] = await db.insert(companies).values({
      name: "Deletion fixture", issuePrefix: `D${randomUUID().slice(0, 7)}`,
    }).returning();
    return company;
  }

  async function revoke(companyId: string, handle: string) {
    return revokeAgentJwt(db, { companyId, handle, userId: "test-operator", reason: "Deletion regression" });
  }

  it("deletes recent revocations across the deleted company's instances and preserves other companies", async () => {
    const target = await createCompany();
    const other = await createCompany();
    const handle = `jti:${randomUUID()}`;
    const recent = await revoke(target.id, handle);
    const retained = await revoke(other.id, handle);
    const otherInstance = await db.insert(agentJwtRevocations).values([target.id, other.id].map((companyId) => ({
      companyId, instanceId: "other-instance", handle, expiresAt: recent.expiresAt,
      revokedByUserId: "test-operator", reason: "Other instance",
    }))).returning();

    expect(recent.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await cleanupAgentJwtRevocations(db, target.id)).toBe(0);
    expect(await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, target.id))).toHaveLength(2);

    expect(await deleteCompany(db, target.id)).toMatchObject({ id: target.id });
    expect(await db.select().from(companies).where(eq(companies.id, target.id))).toEqual([]);
    expect(await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, target.id))).toEqual([]);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, target.id))).toEqual([]);
    expect(await db.select().from(companies).where(eq(companies.id, other.id))).toEqual([other]);
    expect(await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, other.id)))
      .toEqual(expect.arrayContaining([retained, otherInstance[1]]));
    expect(await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, other.id))).toHaveLength(2);
    expect(await db.select().from(activityLog).where(eq(activityLog.companyId, other.id))).toHaveLength(1);
    expect(await deleteCompany(db, target.id)).toBeNull();
  });

  it("rolls revocation deletion back if company deletion fails later in the transaction", async () => {
    const company = await createCompany();
    const revocation = await revoke(company.id, `jti:${randomUUID()}`);
    await db.execute(sql`create table company_deletion_guard (
      company_id uuid references companies(id)
    )`);
    try {
      await db.execute(sql`insert into company_deletion_guard values (${company.id})`);
      await expect(deleteCompany(db, company.id)).rejects.toMatchObject({
        cause: { code: "23503", constraint_name: "company_deletion_guard_company_id_fkey" },
      });
      expect(await db.select().from(companies).where(eq(companies.id, company.id))).toEqual([company]);
      expect(await db.select().from(agentJwtRevocations).where(eq(agentJwtRevocations.companyId, company.id))).toEqual([revocation]);
      expect(await db.select().from(activityLog).where(eq(activityLog.companyId, company.id))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop table company_deletion_guard`);
    }
    expect(await deleteCompany(db, company.id)).toMatchObject({ id: company.id });
  });
});
