CREATE TABLE "cost_event_task_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cost_event_id" uuid NOT NULL,
	"ancestor_issue_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"provenance" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_budget_accounting_state" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"cutover_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor_created_at" timestamp with time zone,
	"cursor_id" uuid,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_budget_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_budget_run_ancestors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"ancestor_issue_id" uuid NOT NULL,
	"depth" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_budget_run_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"live_run_id" uuid,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"billing_code" text,
	"billed_cents" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_state" text DEFAULT 'pending' NOT NULL,
	"token_state" text DEFAULT 'pending' NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"normalization" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_budget_context_owner_uq" UNIQUE("company_id","id"),
	CONSTRAINT "task_budget_context_amount_check" CHECK ("task_budget_run_contexts"."billed_cents" >= 0 AND "task_budget_run_contexts"."total_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_budget_usage_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"receipt_key" text NOT NULL,
	"sequence" bigint NOT NULL,
	"billed_cents" bigint,
	"total_tokens" bigint,
	"is_final" boolean NOT NULL,
	"provenance" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "budget_incidents_policy_window_threshold_idx";--> statement-breakpoint
ALTER TABLE "budget_incidents" ALTER COLUMN "amount_limit" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "budget_policies" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "budget_incidents" ADD COLUMN "policy_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "created_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "updated_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "created_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD COLUMN "updated_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "total_tokens" bigint;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "usage_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_event_task_scopes" ADD CONSTRAINT "cost_event_task_scopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event_task_scopes" ADD CONSTRAINT "cost_event_task_scopes_cost_event_id_cost_events_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_accounting_state" ADD CONSTRAINT "task_budget_accounting_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_effects" ADD CONSTRAINT "task_budget_effects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_run_ancestors" ADD CONSTRAINT "task_budget_run_ancestors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_run_ancestors" ADD CONSTRAINT "task_budget_run_ancestors_company_id_context_id_task_budget_run_contexts_company_id_id_fk" FOREIGN KEY ("company_id","context_id") REFERENCES "public"."task_budget_run_contexts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_run_contexts" ADD CONSTRAINT "task_budget_run_contexts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_run_contexts" ADD CONSTRAINT "task_budget_run_contexts_live_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("live_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_usage_receipts" ADD CONSTRAINT "task_budget_usage_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_budget_usage_receipts" ADD CONSTRAINT "task_budget_usage_receipts_company_id_context_id_task_budget_run_contexts_company_id_id_fk" FOREIGN KEY ("company_id","context_id") REFERENCES "public"."task_budget_run_contexts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_event_task_scope_uq" ON "cost_event_task_scopes" USING btree ("cost_event_id","ancestor_issue_id");--> statement-breakpoint
CREATE INDEX "cost_event_task_scope_idx" ON "cost_event_task_scopes" USING btree ("company_id","ancestor_issue_id","cost_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_budget_effect_dedupe_uq" ON "task_budget_effects" USING btree ("company_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "task_budget_effect_pending_idx" ON "task_budget_effects" USING btree ("state","lease_expires_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_budget_run_ancestor_uq" ON "task_budget_run_ancestors" USING btree ("context_id","ancestor_issue_id");--> statement-breakpoint
CREATE INDEX "task_budget_run_ancestor_scope_idx" ON "task_budget_run_ancestors" USING btree ("company_id","ancestor_issue_id","context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_budget_context_run_uq" ON "task_budget_run_contexts" USING btree ("company_id","source_run_id");--> statement-breakpoint
CREATE INDEX "task_budget_context_live_idx" ON "task_budget_run_contexts" USING btree ("company_id","live_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_budget_receipt_key_uq" ON "task_budget_usage_receipts" USING btree ("context_id","receipt_key");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_incidents_task_revision_threshold_idx" ON "budget_incidents" USING btree ("policy_id","policy_revision","window_start","threshold_type") WHERE "budget_incidents"."scope_type" = 'issue';--> statement-breakpoint
CREATE UNIQUE INDEX "cost_events_usage_receipt_uq" ON "cost_events" USING btree ("usage_receipt_id");--> statement-breakpoint
CREATE INDEX "cost_events_company_created_idx" ON "cost_events" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_incidents_policy_window_threshold_idx" ON "budget_incidents" USING btree ("policy_id","window_start","threshold_type") WHERE "budget_incidents"."status" = 'open' AND "budget_incidents"."scope_type" <> 'issue';