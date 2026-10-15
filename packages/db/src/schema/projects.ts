import { pgTable, uuid, text, timestamp, date, index, jsonb } from "drizzle-orm/pg-core";
import type { AgentEnvConfig } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    goalId: uuid("goal_id").references(() => goals.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("backlog"),
    /**
     * Workflow zone for focus management: "b" is the single active lane a
     * company works in at a time; "a" is parked (zero burn). The server
     * enforces at most one zone-"b" project per company (see
     * doc/plans/2026-10-02-zones.md). Text column mirroring `status`, with a
     * server default so existing rows backfill to the parked zone.
     */
    zone: text("zone").notNull().default("a"),
    /**
     * Night-crew lot state for a parked (zone-"a") project: how far the
     * crew has worked the idea — "prepping" | "questions" | "ready" |
     * "built" (see doc/plans/2026-10-02-night-crew.md). NULL means
     * untouched — nothing has picked the item up yet. Mirrors the `zone`
     * column pattern (text, no DB enum) but is nullable with NO default,
     * so existing rows stay NULL instead of backfilling.
     */
    lot_state: text("lot_state"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id),
    targetDate: date("target_date"),
    color: text("color"),
    icon: text("icon"),
    /**
     * Owner-facing brief: a short markdown TLDR curated by the CoS for the
     * dashboard lane — bullet points with hyperlinks to anything the owner
     * needs (tasks, netenv requests, external links). Distinct from
     * `description` (the project summary) because this is actionable "what
     * needs you" content, not a static summary.
     */
    ownerBrief: text("owner_brief"),
    env: jsonb("env").$type<AgentEnvConfig>(),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    executionWorkspacePolicy: jsonb("execution_workspace_policy").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("projects_company_idx").on(table.companyId),
  }),
);
