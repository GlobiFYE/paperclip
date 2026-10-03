import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

/**
 * Project finish-line items: the bullet list of "what done looks like" for a
 * project. Each item evolves with the project, and tasks (issues) tag the item
 * they serve through `issues.finish_line_item_id`. Distinct from the
 * agent-level `goals` table and the `project_goals` projects-to-goals join.
 */
export const finishLineItems = pgTable(
  "finish_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    title: text("title").notNull(),
    /** The "how it applies to us" instance detail. */
    description: text("description"),
    status: text("status").notNull().default("open"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("finish_line_items_company_idx").on(table.companyId),
    projectIdx: index("finish_line_items_project_idx").on(table.projectId),
  }),
);
