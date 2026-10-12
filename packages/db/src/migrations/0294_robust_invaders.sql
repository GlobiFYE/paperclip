CREATE TABLE "issue_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"summary" text,
	"generation_status" text DEFAULT 'pending' NOT NULL,
	"generation_attempts" integer DEFAULT 0 NOT NULL,
	"generation_error" text,
	"summary_model" text,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_deliverables_issue_uq" UNIQUE("issue_id")
);
--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD CONSTRAINT "issue_deliverables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_deliverables" ADD CONSTRAINT "issue_deliverables_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_deliverables_company_status_idx" ON "issue_deliverables" USING btree ("company_id","generation_status");