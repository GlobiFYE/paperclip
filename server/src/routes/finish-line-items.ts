import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createFinishLineItemSchema,
  updateFinishLineItemSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { finishLineItemService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function finishLineItemRoutes(db: Db) {
  const router = Router();
  const svc = finishLineItemService(db);

  router.get(
    "/companies/:companyId/projects/:projectId/finish-line-items",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      res.json(await svc.list(companyId, projectId));
    },
  );

  router.post(
    "/companies/:companyId/projects/:projectId/finish-line-items",
    validate(createFinishLineItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      const created = await svc.create(companyId, projectId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "finish_line_item.created",
        entityType: "finish_line_item",
        entityId: created.id,
        details: {
          projectId: created.projectId,
          title: created.title,
          status: created.status,
          position: created.position,
        },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/finish-line-items/:id",
    validate(updateFinishLineItemSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const updated = await svc.update(companyId, id, req.body);
      if (!updated) {
        res.status(404).json({ error: "Finish-line item not found" });
        return;
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "finish_line_item.updated",
        entityType: "finish_line_item",
        entityId: updated.id,
        details: {
          projectId: updated.projectId,
          title: updated.title,
          status: updated.status,
          position: updated.position,
        },
      });
      res.json(updated);
    },
  );

  router.delete(
    "/companies/:companyId/finish-line-items/:id",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertCompanyAccess(req, companyId);
      const deleted = await svc.remove(companyId, id);
      if (!deleted) {
        res.status(404).json({ error: "Finish-line item not found" });
        return;
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "finish_line_item.deleted",
        entityType: "finish_line_item",
        entityId: deleted.id,
        details: {
          projectId: deleted.projectId,
          title: deleted.title,
        },
      });
      res.json({ deleted: true });
    },
  );

  return router;
}
