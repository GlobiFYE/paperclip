import type { Approval, AskUserQuestionsInteraction, AttentionItem, AttentionSourceKind, IssueThreadInteraction } from "@paperclipai/shared";
import { pendingAskUserQuestionsInteraction, pendingRequestConfirmationInteraction } from "./issueThreadInteractionFixtures";

export function bulkOwnerConfirmation(id = "owner-confirmation-1"): typeof pendingRequestConfirmationInteraction {
  return { ...pendingRequestConfirmationInteraction, id, companyId: "company-1", issueId: "issue-1", status: "pending",
    title: "Choose the report format", result: null,
    bulkEligibility: { ownerDecision: true, governed: false, unknownKeys: false },
    payload: { version: 1, prompt: "Use a short weekly report?", acceptLabel: "Yes, use a short report",
      target: { type: "custom", key: "owner_decision" } } };
}

export function bulkApproval(id = "hire-1"): Approval {
  return { id, companyId: "company-1", type: "hire_agent", status: "pending", payload: { name: `Specialist ${id}` },
    requestedByAgentId: "agent-1", requestedByUserId: null, decisionNote: null, decidedAt: null,
    decidedByUserId: null, createdAt: new Date("2026-10-12T00:00:00Z"), updatedAt: new Date("2026-10-12T00:00:00Z") };
}

export function bulkQuestions(id = "questions-1"): AskUserQuestionsInteraction {
  return { ...pendingAskUserQuestionsInteraction, id, companyId: "company-1", issueId: "issue-1", status: "pending",
    bulkEligibility: { ownerDecision: false, governed: false, unknownKeys: false },
    payload: { version: 1, questions: [{ id: "model", prompt: "Which model should I use?", selectionMode: "single", required: true,
      options: [{ id: "a", label: "Gemini Flash-Lite" }, { id: "b", label: "Another model" }] }],
      questionSet: { schema: "paperclip.question_set.v1", questions: [{ id: "model", prompt: "Which model should I use?", required: true,
        answerMode: "single_select", options: [{ id: "a", label: "Gemini Flash-Lite", recommended: true }, { id: "b", label: "Another model" }] }] } } };
}

export function bulkAttention(record: Approval | IssueThreadInteraction, sourceKind?: AttentionSourceKind): AttentionItem {
  const interaction = "issueId" in record;
  return {
    id: `attention-${record.id}`, companyId: record.companyId, sourceKind: sourceKind ?? (interaction ? "issue_thread_interaction" : "approval"),
    subject: { id: record.id, companyId: record.companyId, kind: interaction ? "interaction" : "approval", title: `Question ${record.id}`,
      identifier: null, status: record.status, href: `/items/${record.id}` },
    relatedIssue: interaction ? { id: record.issueId, companyId: record.companyId, kind: "issue", title: "Task", identifier: null,
      status: "in_progress", href: `/issues/${record.issueId}` } : null,
    whyNow: "Needs an answer", decisionVerbs: [], inlineResolvable: true, entryRule: "pending", exitRule: "resolved", dedupKey: record.id,
    dismissalKey: record.id, dismissal: null, severity: "low", rank: 1, activityAt: "2026-10-12T00:00:00Z",
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", project: null, workspace: null, expiresAt: null,
    ruleKey: null, originAgentName: "Planner", queues: [], shelf: false, retentionDays: 7, keep: false, archivedAt: null,
    retentionVersion: 1, decideBy: null, decideByAttribution: null, snoozedUntil: null, detail: null, trainingExampleId: null,
  };
}
