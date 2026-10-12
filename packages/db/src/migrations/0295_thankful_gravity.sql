ALTER TABLE "issue_deliverables" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "completion_version" bigint;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "regeneration_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "summary_from_task_details" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD COLUMN "attempt_times" jsonb DEFAULT '[]'::jsonb NOT NULL;