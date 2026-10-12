import {
  askUserQuestionsPayloadSchema,
  requestCheckboxConfirmationPayloadSchema,
  requestConfirmationPayloadSchema,
  respondIssueThreadInteractionSchema,
  type Approval,
  type AskUserQuestionsAnswer,
  type AskUserQuestionsPayload,
  type AttentionItem,
  type IssueThreadInteraction,
} from "@paperclipai/shared";

export type HydratedBulkRecord =
  | { item: AttentionItem; kind: "approval"; record: Approval }
  | { item: AttentionItem; kind: "interaction"; record: IssueThreadInteraction };

export interface BulkConfirmEntry {
  item: AttentionItem;
  title: string;
  askedByAgentId: string | null;
  askedByUserId: string | null;
  answers: string[];
  fingerprint: string;
  action:
    | { kind: "approve_hire"; approvalId: string }
    | { kind: "answer_questions"; issueId: string; interactionId: string; answers: AskUserQuestionsAnswer[] };
}

// G-04: no audited creator supplies a target/subtype guaranteed to be a simple
// owner yes/no confirmation. Even untargeted cards can authorize PR merges.
// Keep this allowlist empty until the server exposes such a discriminant.
// See doc/design/CONFIRM-ALL.md for the creator audit and excluded target keys.
export const BULK_CONFIRM_TARGET_ALLOWLIST: readonly string[] = [];

/** Stable across object-key order and Date/JSON representations; any data drift skips. */
export function bulkRecordFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
    }
    return entry;
  });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate full API records before they enter the planner. Never trust feed metadata. */
export function validateBulkRecord(item: AttentionItem, value: unknown): HydratedBulkRecord | null {
  if (!object(value) || value.id !== item.subject.id || value.companyId !== item.companyId
    || item.subject.companyId !== item.companyId || typeof value.status !== "string"
    || !value.updatedAt || !object(value.payload)) return null;
  if (item.sourceKind === "approval" && item.subject.kind === "approval") {
    if (typeof value.type !== "string") return null;
    return { item, kind: "approval", record: value as unknown as Approval };
  }
  if (item.sourceKind !== "issue_thread_interaction" || item.subject.kind !== "interaction"
    || !item.relatedIssue || value.issueId !== item.relatedIssue.id
    || item.relatedIssue.companyId !== item.companyId) return null;
  // Reject governed metadata before parsing: Zod can otherwise strip it.
  const payload = value.payload;
  if (["toolAction", "secretProposal", "connectionAuthorization"].some((key) => key in payload)
    || value.effectiveResolverPolicySource === "governed_action") return null;
  const schema = value.kind === "ask_user_questions" ? askUserQuestionsPayloadSchema
    : value.kind === "request_confirmation" ? requestConfirmationPayloadSchema
      : value.kind === "request_checkbox_confirmation" ? requestCheckboxConfirmationPayloadSchema : null;
  if (!schema?.safeParse(value.payload).success) return null;
  if (value.kind !== "ask_user_questions"
    && (!object(payload.target) || typeof payload.target.key !== "string"
      || !BULK_CONFIRM_TARGET_ALLOWLIST.includes(payload.target.key))) return null;
  return { item, kind: "interaction", record: value as unknown as IssueThreadInteraction };
}

/** Only explicit canonical recommendation flags count; labels and option style never do. */
export function recommendedQuestionAnswers(payload: AskUserQuestionsPayload): {
  answers: AskUserQuestionsAnswer[];
  labels: string[];
} | null {
  const canonical = payload.questionSet?.questions;
  if (!canonical?.length || canonical.length !== payload.questions.length) return null;
  const answers: AskUserQuestionsAnswer[] = [];
  const labels: string[] = [];
  for (const question of payload.questions) {
    const shown = canonical.find((entry) => entry.id === question.id);
    if (!shown || shown.prompt !== question.prompt || shown.answerMode === "text"
      || shown.answerMode !== (question.selectionMode === "single" ? "single_select" : "multi_select")) return null;
    const options = shown.options ?? [];
    const choices = options.filter((option) => option.recommended === true);
    if (choices.length === 0 || (question.selectionMode === "single" && choices.length !== 1)
      || new Set(options.map((option) => option.id)).size !== options.length) return null;
    // Both representations must describe the same choices. An optional custom
    // text answer is fine, but a recommended free-text answer is not executable.
    if (options.some((option) => !question.options.some((legacy) =>
      legacy.id === option.id && legacy.label === option.label && !legacy.freeText))
      || question.options.filter((option) => !option.freeText).length !== options.length) return null;
    answers.push({ questionId: question.id, optionIds: choices.map((option) => option.id) });
    labels.push(`${question.prompt} — Answer: ${choices.map((option) => option.label).join(", ")} (recommended)`);
  }
  return respondIssueThreadInteractionSchema.safeParse({ answers }).success ? { answers, labels } : null;
}

/** The single source of truth for the count, preview and executable actions. */
export function bulkConfirmPlan(items: readonly HydratedBulkRecord[]): BulkConfirmEntry[] {
  const plan: BulkConfirmEntry[] = [];
  const seen = new Set<string>();
  for (const hydrated of items) {
    const { item, record } = hydrated;
    const identity = `${item.sourceKind}:${record.id}`;
    if (seen.has(identity) || record.status !== "pending") continue;
    seen.add(identity);
    const common = { item, fingerprint: bulkRecordFingerprint(record) };
    if (hydrated.kind === "approval") {
      const approval = hydrated.record;
      if (approval.type !== "hire_agent") continue;
      const name = typeof approval.payload.name === "string" ? approval.payload.name : item.subject.title;
      if (!name?.trim()) continue;
      plan.push({ ...common, title: item.subject.title ?? name,
        askedByAgentId: approval.requestedByAgentId, askedByUserId: approval.requestedByUserId,
        answers: [`Approve hire: ${name}`], action: { kind: "approve_hire", approvalId: approval.id } });
    } else if (hydrated.record.kind === "ask_user_questions") {
      const interaction = hydrated.record;
      const recommended = recommendedQuestionAnswers(interaction.payload);
      if (!recommended) continue;
      plan.push({ ...common, title: interaction.title ?? interaction.payload.title ?? item.subject.title ?? "Answer questions",
        askedByAgentId: interaction.createdByAgentId ?? null, askedByUserId: interaction.createdByUserId ?? null,
        answers: recommended.labels, action: { kind: "answer_questions", issueId: interaction.issueId,
          interactionId: interaction.id, answers: recommended.answers } });
    }
    // Decisions lack a recommendation flag. All confirmations fail the empty
    // target/subtype allowlist; reviews and every other source remain individual.
  }
  return plan;
}
