CREATE TABLE "agent_jwt_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"handle" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_jwt_revocations" ADD CONSTRAINT "agent_jwt_revocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_jwt_revocations_handle_idx" ON "agent_jwt_revocations" USING btree ("instance_id","company_id","handle");--> statement-breakpoint
CREATE INDEX "agent_jwt_revocations_expiry_idx" ON "agent_jwt_revocations" USING btree ("instance_id","expires_at");