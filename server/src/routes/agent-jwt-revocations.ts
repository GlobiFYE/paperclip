import { Router } from "express";
import { activityLog, type Db } from "@paperclipai/db";
import { revokeAgentJwtSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, assertInstanceAdmin } from "./authz.js";
import { cleanupAgentJwtRevocations, revokeAgentJwt } from "../services/agent-jwt-revocations.js";

export function agentJwtRevocationRoutes(db: Db) {
  const router = Router();
  router.post("/companies/:companyId/agent-jwt-revocations", validate(revokeAgentJwtSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const companyId = String(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const row = await revokeAgentJwt(db, { ...req.body, companyId, userId: req.actor.userId! });
    res.status(201).json(row);
  });
  router.post("/companies/:companyId/agent-jwt-revocations/cleanup", async (req, res) => {
    assertInstanceAdmin(req);
    const companyId = String(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const removed = await db.transaction(async (tx) => {
      const count = await cleanupAgentJwtRevocations(tx as unknown as Db, companyId);
      await tx.insert(activityLog).values({
        companyId, actorType: "user", actorId: req.actor.userId!,
        action: "auth.agent_jwt_revocations_cleaned", entityType: "company", entityId: companyId,
        details: { removed: count },
      });
      return count;
    });
    res.json({ removed });
  });
  return router;
}
