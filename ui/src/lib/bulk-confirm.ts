import {
  askUserQuestionsPayloadSchema,
  requestConfirmationCustomTargetSchema,
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
  details: { label: string; markdown: string }[];
  fingerprint: string;
  action:
    | { kind: "approve_hire"; approvalId: string }
    | { kind: "accept_confirmation"; issueId: string; interactionId: string }
    | { kind: "answer_questions"; issueId: string; interactionId: string; answers: AskUserQuestionsAnswer[] };
}

// G-04 + host follow-up: agents explicitly identify simple owner yes/no input.
// Untargeted cards can authorize PR merges and must remain individual.
// See doc/design/CONFIRM-ALL.md for the creator audit and excluded target keys.
export const BULK_CONFIRM_TARGET_ALLOWLIST: readonly string[] = ["owner_decision"];

// Defense in depth for metadata that survives API hydration. Raw stored keys
// are checked by the server; the client must also require its classification.
const bulkOwnerConfirmationPayloadSchema = requestConfirmationPayloadSchema.strict();
const bulkOwnerConfirmationTargetSchema = requestConfirmationCustomTargetSchema.strict();

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
export function validateBulkRecord(item: AttentionItem, value: unknown, currentUserId?: string | null): HydratedBulkRecord | null {
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
  // Match the server's human audience rules, including its human override of
  // agent-addressed cards. Identity-dependent restrictions fail closed.
  if (!["anyone", "human_only", "not_creator"].includes(String(value.effectiveResolverPolicy))
    || (value.addresseeUserId && value.addresseeUserId !== currentUserId)
    || (value.effectiveResolverPolicy === "not_creator"
      && (!currentUserId || value.createdByUserId === currentUserId))) return null;
  // Reject governed metadata before parsing: Zod can otherwise strip it.
  const payload = value.payload;
  if (["toolAction", "secretProposal", "connectionAuthorization"].some((key) => key in payload)
    || value.effectiveResolverPolicySource === "governed_action") return null;
  const schema = value.kind === "ask_user_questions" ? askUserQuestionsPayloadSchema
    : value.kind === "request_confirmation" ? bulkOwnerConfirmationPayloadSchema : null;
  if (!schema?.safeParse(value.payload).success) return null;
  // Question read schemas also strip governed metadata. Require the server's
  // raw-row classification instead of relying on surviving payload keys.
  if (!object(value.bulkEligibility) || value.bulkEligibility.governed !== false) return null;
  if (value.kind === "request_confirmation") {
    const eligibility = value.bulkEligibility;
    if (!object(eligibility) || eligibility.ownerDecision !== true
      || eligibility.governed !== false || eligibility.unknownKeys !== false) return null;
  }
  if (value.kind !== "ask_user_questions"
    && (!object(payload.target) || payload.target.type !== "custom"
      || !bulkOwnerConfirmationTargetSchema.safeParse(payload.target).success
      || typeof payload.target.key !== "string"
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
  // These answers authorize external connection routing, even if recommended.
  if ([...payload.questions, ...canonical].some((question) => question.id.startsWith("connection-provider:"))) return null;
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
    const common = { item, fingerprint: bulkRecordFingerprint(record), details: [] };
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
      const details: BulkConfirmEntry["details"] = [];
      if (interaction.payload.questionSet?.description?.trim()) {
        details.push({ label: "Question context", markdown: interaction.payload.questionSet.description });
      }
      for (const question of interaction.payload.questions) {
        const canonical = interaction.payload.questionSet?.questions.find((entry) => entry.id === question.id);
        for (const help of new Set([question.helpText, canonical?.helpText])) {
          if (help?.trim()) details.push({ label: question.prompt, markdown: help });
        }
        for (const option of question.options) {
          const canonicalOption = canonical?.options?.find((entry) => entry.id === option.id);
          for (const description of new Set([option.description, canonicalOption?.description])) {
            if (description?.trim()) details.push({ label: `${question.prompt} — ${option.label}`, markdown: description });
          }
        }
      }
      plan.push({ ...common, title: interaction.title ?? interaction.payload.title ?? item.subject.title ?? "Answer questions",
        askedByAgentId: interaction.createdByAgentId ?? null, askedByUserId: interaction.createdByUserId ?? null,
        answers: recommended.labels, details, action: { kind: "answer_questions", issueId: interaction.issueId,
          interactionId: interaction.id, answers: recommended.answers } });
    } else if (hydrated.record.kind === "request_confirmation") {
      const interaction = hydrated.record;
      plan.push({ ...common, title: interaction.title ?? interaction.payload.prompt,
        askedByAgentId: interaction.createdByAgentId ?? null, askedByUserId: interaction.createdByUserId ?? null,
        answers: [`${interaction.payload.prompt} — Answer: ${interaction.payload.acceptLabel ?? "Confirm"}`],
        details: interaction.payload.detailsMarkdown?.trim()
          ? [{ label: "Confirmation details", markdown: interaction.payload.detailsMarkdown }] : [],
        action: { kind: "accept_confirmation", issueId: interaction.issueId, interactionId: interaction.id } });
    }
    // Decisions lack a recommendation flag; reviews and other sources remain individual.
  }
  return plan;
}
