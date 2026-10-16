import { createHash } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { activityLog, agentJwtRevocations, type Db } from "@paperclipai/db";
import { MAX_AGENT_JWT_TTL_SECONDS, type LocalAgentJwtClaims } from "../agent-auth-jwt.js";
import { resolvePaperclipInstanceId } from "../home-paths.js";

export function agentJwtRevocationHandles(token: string, claims: LocalAgentJwtClaims): string[] {
  // Hash every token as well as checking jti, so operators can use one workflow
  // across the pre-jti rollout. Never persist or log the bearer itself.
  return [
    `sha256:${createHash("sha256").update(token).digest("hex")}`,
    ...(claims.jti ? [`jti:${claims.jti}`] : []),
  ];
}

export async function isAgentJwtRevoked(db: Db, token: string, claims: LocalAgentJwtClaims): Promise<boolean> {
  const rows = await db.select({ id: agentJwtRevocations.id }).from(agentJwtRevocations).where(and(
    eq(agentJwtRevocations.instanceId, resolvePaperclipInstanceId()),
    eq(agentJwtRevocations.companyId, claims.company_id),
    inArray(agentJwtRevocations.handle, agentJwtRevocationHandles(token, claims)),
  ));
  return rows.length > 0;
}

export async function revokeAgentJwt(db: Db, input: {
  companyId: string; handle: string; reason: string; userId: string;
}) {
  const instanceId = resolvePaperclipInstanceId();
  return db.transaction(async (tx) => {
    // Retain for the maximum *accepted* lifetime from receipt, not an operator's
    // unverified exp. The verifier rejects future iat and longer lifetimes.
    const [revocation] = await tx.insert(agentJwtRevocations).values({
      companyId: input.companyId,
      instanceId,
      handle: input.handle,
      expiresAt: sql`clock_timestamp() + ${MAX_AGENT_JWT_TTL_SECONDS} * interval '1 second'`,
      revokedByUserId: input.userId,
      reason: input.reason,
    }).onConflictDoUpdate({
      target: [agentJwtRevocations.instanceId, agentJwtRevocations.companyId, agentJwtRevocations.handle],
      set: { expiresAt: sql`greatest(${agentJwtRevocations.expiresAt}, clock_timestamp() + ${MAX_AGENT_JWT_TTL_SECONDS} * interval '1 second')` },
    }).returning();
    await tx.insert(activityLog).values({
      companyId: input.companyId, actorType: "user", actorId: input.userId,
      action: "auth.agent_jwt_revoked", entityType: "agent_jwt_revocation", entityId: revocation.id,
      details: { instanceId, handle: input.handle, reason: input.reason, expiresAt: revocation.expiresAt.toISOString() },
    });
    return revocation;
  });
}

/** Bounded, instance-scoped maintenance. Expiry is a retention floor, never an auth allow rule. */
export async function cleanupAgentJwtRevocations(db: Db, companyId: string): Promise<number> {
  const instanceId = resolvePaperclipInstanceId();
  const expired = db.select({ id: agentJwtRevocations.id }).from(agentJwtRevocations).where(and(
    eq(agentJwtRevocations.instanceId, instanceId),
    eq(agentJwtRevocations.companyId, companyId),
    // Five extra minutes tolerate small DB/API clock differences during cleanup.
    lte(agentJwtRevocations.expiresAt, sql`clock_timestamp() - interval '5 minutes'`),
  )).orderBy(agentJwtRevocations.expiresAt).limit(1000);
  const removed = await db.delete(agentJwtRevocations).where(and(
    inArray(agentJwtRevocations.id, expired),
    // Recheck after a concurrent re-revocation extends retention.
    lte(agentJwtRevocations.expiresAt, sql`clock_timestamp() - interval '5 minutes'`),
  )).returning({ id: agentJwtRevocations.id });
  return removed.length;
}
