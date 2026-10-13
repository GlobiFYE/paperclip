import type { DecisionOutcome } from "../../api/decisions";

/** HTTP outcome() shape: the full decisions table row (including signed_spec), plus executions.
 * Mirrors packages/db/src/schema/decisions.ts and server/src/services/decisions.ts;
 * timestamps are serialized to strings by the route's JSON response.
 */
export function plainDecision(): DecisionOutcome & { signedSpec: string } {
  return { id: "decision-1", companyId: "company-1", bundleId: null, originAgentId: "agent-1", originIssueId: "issue-1", originRunId: "run-1",
    ruleKey: null, title: "Pick a color", body: "Choose a theme", options: [{ id: "blue", label: "Blue", effects: [] }], inputs: null,
    status: "open", executionStatus: null, chosenOptionId: null, inputValues: null, decidedByUserId: null, decidedAt: null,
    expiresAt: "2026-11-01T00:00:00Z", idempotencyKey: null, signedSpec: "opaque-server-signature", targetSnapshots: {}, continuationPolicy: "none", metadata: {},
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", executions: [] };
}
