import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { goalProgressService } from "../services/goal-progress.js";
import { assertCompanyAccess } from "./authz.js";

export function goalProgressRoutes(db: Db) {
  const router = Router();
  const svc = goalProgressService(db);

  router.get("/companies/:companyId/goal-progress", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.summary(companyId));
  });

  return router;
}
