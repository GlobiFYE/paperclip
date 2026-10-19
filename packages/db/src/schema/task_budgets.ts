import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { costEvents } from "./cost_events.js";

export const taskBudgetAccountingState = pgTable("task_budget_accounting_state", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("pending"),
  cutoverAt: timestamp("cutover_at", { withTimezone: true }).notNull().defaultNow(),
  cursorCreatedAt: timestamp("cursor_created_at", { withTimezone: true }),
  cursorId: uuid("cursor_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const taskBudgetRunContexts = pgTable("task_budget_run_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceRunId: uuid("source_run_id").notNull(),
  liveRunId: uuid("live_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
  issueId: uuid("issue_id").notNull(),
  projectId: uuid("project_id"),
  billingCode: text("billing_code"),
  billedCents: bigint("billed_cents", { mode: "number" }).notNull().default(0),
  totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
  costState: text("cost_state").notNull().default("pending"),
  tokenState: text("token_state").notNull().default("pending"),
  lastSequence: bigint("last_sequence", { mode: "number" }).notNull().default(0),
  normalization: jsonb("normalization").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  sourceUq: uniqueIndex("task_budget_context_run_uq").on(table.companyId, table.sourceRunId),
  ownerUq: unique("task_budget_context_owner_uq").on(table.companyId, table.id),
  liveIdx: index("task_budget_context_live_idx").on(table.companyId, table.liveRunId),
  amountCheck: check("task_budget_context_amount_check", sql`${table.billedCents} >= 0 AND ${table.totalTokens} >= 0`),
}));

export const taskBudgetRunAncestors = pgTable("task_budget_run_ancestors", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").notNull(),
  ancestorIssueId: uuid("ancestor_issue_id").notNull(),
  depth: integer("depth").notNull(),
}, table => ({
  contextFk: foreignKey({ columns: [table.companyId, table.contextId], foreignColumns: [taskBudgetRunContexts.companyId, taskBudgetRunContexts.id] }).onDelete("cascade"),
  uniqueScope: uniqueIndex("task_budget_run_ancestor_uq").on(table.contextId, table.ancestorIssueId),
  scopeIdx: index("task_budget_run_ancestor_scope_idx").on(table.companyId, table.ancestorIssueId, table.contextId),
}));

export const taskBudgetUsageReceipts = pgTable("task_budget_usage_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contextId: uuid("context_id").notNull(),
  receiptKey: text("receipt_key").notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  billedCents: bigint("billed_cents", { mode: "number" }),
  totalTokens: bigint("total_tokens", { mode: "number" }),
  isFinal: boolean("is_final").notNull(),
  provenance: text("provenance").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  contextFk: foreignKey({ columns: [table.companyId, table.contextId], foreignColumns: [taskBudgetRunContexts.companyId, taskBudgetRunContexts.id] }).onDelete("cascade"),
  receiptUq: uniqueIndex("task_budget_receipt_key_uq").on(table.contextId, table.receiptKey),
}));

export const costEventTaskScopes = pgTable("cost_event_task_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  costEventId: uuid("cost_event_id").notNull().references(() => costEvents.id, { onDelete: "cascade" }),
  ancestorIssueId: uuid("ancestor_issue_id").notNull(),
  depth: integer("depth").notNull(),
  provenance: text("provenance").notNull(),
}, table => ({
  eventScopeUq: uniqueIndex("cost_event_task_scope_uq").on(table.costEventId, table.ancestorIssueId),
  scopeIdx: index("cost_event_task_scope_idx").on(table.companyId, table.ancestorIssueId, table.costEventId),
}));

export const taskBudgetEffects = pgTable("task_budget_effects", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scopeId: uuid("scope_id").notNull(),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  payload: jsonb("payload").$type<{ issueIds?: string[]; runIds?: string[]; wakeupIds?: string[] }>().notNull().default({}),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => ({
  dedupeUq: uniqueIndex("task_budget_effect_dedupe_uq").on(table.companyId, table.dedupeKey),
  pendingIdx: index("task_budget_effect_pending_idx").on(table.state, table.leaseExpiresAt, table.createdAt),
}));
