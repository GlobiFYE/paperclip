import type { Db } from "@paperclipai/db";

/** Database capabilities stay in the adapter layer, not application ports. */
export type AgentSchedulerDb = Pick<Db, "select" | "insert" | "update" | "transaction">;
