ALTER TABLE "company_skill_sources" ADD COLUMN "last_scan_tree_sha" text;--> statement-breakpoint
ALTER TABLE "company_skill_sources" ADD COLUMN "automatic_budget_bytes" integer DEFAULT 536870912 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_skill_sources" ADD COLUMN "automatic_budget_at" timestamp with time zone DEFAULT now() NOT NULL;