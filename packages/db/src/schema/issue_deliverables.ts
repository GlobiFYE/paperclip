import { boolean, jsonb, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { DeliverableGenerationStatus } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * One plain-English "what was done" summary per completed issue (TOP-193).
 *
 * Summaries settle after completion; durable claims bound retries and repairs
 * when comments or outputs arrive late. The Deliverables page renders the
 * stored text and never calls a model on load.
 */
export const issueDeliverables = pgTable(
  "issue_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    summary: text("summary"),
    generationStatus: text("generation_status")
      .$type<DeliverableGenerationStatus>()
      .notNull()
      .default("pending"),
    generationAttempts: integer("generation_attempts").notNull().default(0),
    sourceFingerprint: text("source_fingerprint"),
    // Full-precision completion timestamp, independent of ownership/statusVersion.
    completionKey: text("completion_key"),
    configFingerprint: text("config_fingerprint"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    regenerationCount: integer("regeneration_count").notNull().default(0),
    summaryFromTaskDetails: boolean("summary_from_task_details").notNull().default(false),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    attemptTimes: jsonb("attempt_times").$type<string[]>().notNull().default([]),
    generationError: text("generation_error"),
    summaryModel: text("summary_model"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checkedIdx: index("issue_deliverables_checked_idx").on(table.checkedAt),
    issueUq: unique("issue_deliverables_issue_uq").on(table.issueId),
    companyStatusIdx: index("issue_deliverables_company_status_idx").on(
      table.companyId,
      table.generationStatus,
    ),
  }),
);
