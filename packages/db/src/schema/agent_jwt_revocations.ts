import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const agentJwtRevocations = pgTable(
  "agent_jwt_revocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    instanceId: text("instance_id").notNull(),
    handle: text("handle").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedByUserId: text("revoked_by_user_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    handleIdx: uniqueIndex("agent_jwt_revocations_handle_idx").on(table.instanceId, table.companyId, table.handle),
    expiryIdx: index("agent_jwt_revocations_expiry_idx").on(table.instanceId, table.expiresAt),
  }),
);
