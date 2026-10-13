import type { AttentionItem } from "@paperclipai/shared";
import { bulkConfirmPlan, validateBulkRecord, type HydratedBulkRecord } from "../../lib/bulk-confirm";
import type { DecisionOutcome } from "../../api/decisions";

export type DecisionCategory = "hiring" | "yesno" | "question" | "closer_look";
export type HydratedDecision = HydratedBulkRecord | { item: AttentionItem; kind: "decision"; record: DecisionOutcome };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

export function validateDecisionRecord(item: AttentionItem, value: unknown, currentUserId?: string | null): HydratedDecision | null {
  if (item.sourceKind !== "decision") return validateBulkRecord(item, value, currentUserId);
  if (!object(value) || value.id !== item.subject.id || value.companyId !== item.companyId
    || item.subject.companyId !== item.companyId || item.subject.kind !== "decision"
    || !value.updatedAt || typeof value.title !== "string") return null;
  return { item, kind: "decision", record: value as unknown as DecisionOutcome };
}

/** Deliberately closed allowlist: any execution, input or unknown metadata keeps the full resolver. */
function plainChoice(record: DecisionOutcome): boolean {
  return onlyKeys(record as unknown as Record<string, unknown>, [
    "id", "companyId", "bundleId", "originAgentId", "originIssueId", "originRunId", "ruleKey", "title", "body",
    "options", "inputs", "status", "executionStatus", "chosenOptionId", "inputValues", "decidedByUserId", "decidedAt",
    "expiresAt", "idempotencyKey", "signedSpec", "targetSnapshots", "continuationPolicy", "metadata", "createdAt", "updatedAt", "executions",
  ]) && record.status === "open" && record.executionStatus == null && record.ruleKey == null
    && (record.inputs === null || (Array.isArray(record.inputs) && record.inputs.length === 0))
    && object(record.metadata) && Object.keys(record.metadata).length === 0
    && object(record.targetSnapshots) && Object.keys(record.targetSnapshots).length === 0
    && Array.isArray(record.executions) && record.executions.length === 0
    && ["none", "wake_origin_agent"].includes(record.continuationPolicy)
    && Array.isArray(record.options) && record.options.length > 0 && record.options.length <= 8
    && new Set(record.options.map((option) => option.id)).size === record.options.length
    && record.options.every((option) => object(option)
      && onlyKeys(option, ["id", "label", "description", "style", "effects"])
      && typeof option.id === "string" && typeof option.label === "string"
      && (option.style === undefined || ["default", "primary"].includes(option.style))
      && Array.isArray(option.effects) && option.effects.length === 0);
}

export function classifyDecision(item: AttentionItem, hydratedRecord: HydratedDecision | null | undefined): DecisionCategory {
  if (!hydratedRecord || hydratedRecord.item.id !== item.id || hydratedRecord.record.id !== item.subject.id
    || hydratedRecord.record.companyId !== item.companyId) return "closer_look";
  if (hydratedRecord.kind === "decision") return item.decisionVerbs.every((verb) => verb.id === "decide") && plainChoice(hydratedRecord.record) ? "question" : "closer_look";
  const record = hydratedRecord.record;
  if (record.status !== "pending") return "closer_look";
  if (hydratedRecord.kind === "approval") {
    return bulkConfirmPlan([hydratedRecord]).length ? "hiring" : "closer_look";
  }
  if (hydratedRecord.record.kind === "request_confirmation") {
    const eligibility = hydratedRecord.record.bulkEligibility;
    return eligibility?.ownerDecision === true && eligibility.governed === false && eligibility.unknownKeys === false
      && bulkConfirmPlan([hydratedRecord]).length ? "yesno" : "closer_look";
  }
  if (hydratedRecord.record.kind === "ask_user_questions") {
    const { payload, bulkEligibility } = hydratedRecord.record;
    if (bulkEligibility?.governed !== false || bulkEligibility.unknownKeys !== false
      || payload.questions.length > 20 || payload.questions.length === 0
      || [...payload.questions, ...(payload.questionSet?.questions ?? [])].some((question) => question.id.startsWith("connection-provider:"))) return "closer_look";
    return "question";
  }
  return "closer_look";
}
