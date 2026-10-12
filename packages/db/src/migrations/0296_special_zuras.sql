ALTER TABLE "issue_deliverables" ADD COLUMN "completion_key" text;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "config_fingerprint" text;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "issue_deliverables_checked_idx" ON "issue_deliverables" USING btree ("checked_at");