ALTER TABLE "mcp_attachment_uploads" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_attachment_uploads" ADD COLUMN "work_session_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_file_tickets" ADD COLUMN "work_session_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_attachment_uploads" ADD CONSTRAINT "mcp_attachment_uploads_grant_id_mcp_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;