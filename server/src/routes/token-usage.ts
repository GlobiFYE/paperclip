import { Router } from "express";
import { badRequest } from "../errors.js";
import { readTokenUsage } from "../services/token-usage.js";
import { assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

export function tokenUsageRoutes() {
  const router = Router();
  router.get("/companies/:companyId/token-usage", async (req, res) => {
    assertInstanceAdmin(req);
    const companyId = String(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const window = req.query.window ?? "d7";
    if (window !== "today" && window !== "d7" && window !== "d30") {
      throw badRequest("Unknown usage window");
    }
    res.setHeader("Cache-Control", "no-store");
    if (companyId !== (process.env.PANTHEON_USAGE_COMPANY_ID ?? "57cfaea0-c864-4bff-9433-2fad7be3d4c5")) {
      res.json({ available: false, reason: "not_configured" });
      return;
    }
    res.json(await readTokenUsage(window));
  });
  return router;
}
