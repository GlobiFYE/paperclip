import { requestConfirmationCustomTargetSchema, requestConfirmationPayloadSchema,
  type IssueThreadInteraction } from "@paperclipai/shared";

const strictPayload = requestConfirmationPayloadSchema.strict();
const strictTarget = requestConfirmationCustomTargetSchema.strict();
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface BulkEligibilityIssueContext {
  status?: string | null;
  workMode?: string | null;
}

/** Read-only classification of raw database values, before hydrateInteraction strips keys. */
export function interactionBulkEligibility(row: {
  kind: string; payload: unknown; effectiveResolverPolicySource?: string | null;
}, parentIssue?: BulkEligibilityIssueContext | null): NonNullable<IssueThreadInteraction["bulkEligibility"]> {
  const payload = object(row.payload) ? row.payload : {};
  const target = object(payload.target) ? payload.target : {};
  // connection-intents consumes saved provider answers as human consent.
  // Check both representations before parsing, even when an agent adds recommendations.
  const questionSet = object(payload.questionSet) ? payload.questionSet : {};
  const consentQuestion = row.kind === "ask_user_questions"
    && [payload.questions, questionSet.questions].some((questions) => Array.isArray(questions)
      && questions.some((question) => object(question) && typeof question.id === "string"
        && question.id.startsWith("connection-provider:")));
  const governed = row.effectiveResolverPolicySource === "governed_action"
    || consentQuestion
    // Target keys do not prevent plan continuation or issue review verdicts.
    // Only known active statuses and owner-question modes are safe; missing
    // parent context fails closed for both confirmation kinds.
    || (["request_confirmation", "request_checkbox_confirmation"].includes(row.kind)
      && (!["todo", "in_progress", "blocked"].includes(parentIssue?.status ?? "")
        || !["standard", "ask"].includes(parentIssue?.workMode ?? "")
        || (target.type === "issue_document" && target.key === "plan")))
    || ["toolAction", "secretProposal", "connectionAuthorization"].some((key) => key in payload);
  if (row.kind !== "request_confirmation") return { ownerDecision: false, governed, unknownKeys: false };
  const parsed = strictPayload.safeParse(row.payload);
  const parsedTarget = strictTarget.safeParse(payload.target);
  const unknownKeys = [parsed, parsedTarget].some((result) => !result.success
    && result.error.issues.some((issue) => issue.code === "unrecognized_keys"));
  return {
    ownerDecision: row.kind === "request_confirmation" && target.type === "custom"
      && target.key === "owner_decision" && parsed.success && parsedTarget.success,
    governed,
    unknownKeys,
  };
}
