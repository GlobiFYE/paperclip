import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import {
  DEFAULT_RECOVERY_RATE_THRESHOLD_PERCENT,
  MAX_WINDOW_WEEKS,
  recoveryObservabilityService,
} from "../services/recovery-observability.js";
import { assertCompanyAccess } from "./authz.js";

function parsePositiveNumber(
  value: unknown,
  fallback: number,
  max?: number,
): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max != null ? Math.min(parsed, max) : parsed;
}

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);
  const recoveryObservability = recoveryObservabilityService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  // Night-crew ADHD edition (doc/plans/2026-10-02-night-crew.md §2b): the
  // active-lane HQ payload. Board-gated company read like the classic
  // summary; read-only, so no activity log entry applies.
  router.get("/companies/:companyId/dashboard/focus", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const focus = await svc.focus(companyId);
    res.json(focus);
  });

  router.get("/companies/:companyId/recovery-observability", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const weeks = parsePositiveNumber(req.query.weeks, 8, MAX_WINDOW_WEEKS);
    const thresholdPercent = parsePositiveNumber(
      req.query.threshold,
      DEFAULT_RECOVERY_RATE_THRESHOLD_PERCENT,
    );
    const report = await recoveryObservability.report(companyId, {
      weeks,
      thresholdPercent,
    });
    res.json(report);
  });

  return router;
}
