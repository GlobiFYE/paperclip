CREATE TABLE "finish_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "finish_line_item_id" uuid;--> statement-breakpoint
ALTER TABLE "finish_line_items" ADD CONSTRAINT "finish_line_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finish_line_items" ADD CONSTRAINT "finish_line_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finish_line_items_company_idx" ON "finish_line_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "finish_line_items_project_idx" ON "finish_line_items" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_finish_line_item_id_finish_line_items_id_fk" FOREIGN KEY ("finish_line_item_id") REFERENCES "public"."finish_line_items"("id") ON DELETE no action ON UPDATE no action;