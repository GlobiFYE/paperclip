import { describe, expect, it, vi, afterEach } from "vitest";
import { ATTENTION_SOURCE_KINDS, type IssueThreadInteraction } from "@paperclipai/shared";
import { bulkApproval, bulkAttention, bulkQuestions } from "../fixtures/bulkConfirmFixtures";
import { pendingRequestConfirmationInteraction } from "../fixtures/issueThreadInteractionFixtures";
import { BULK_CONFIRM_TARGET_ALLOWLIST, bulkConfirmPlan, validateBulkRecord, type HydratedBulkRecord } from "./bulk-confirm";
import { hydrateBulkItems, runBulkConfirm } from "./bulk-confirm-api";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";

afterEach(() => vi.restoreAllMocks());
const validated = (record: ReturnType<typeof bulkApproval> | IssueThreadInteraction) => {
  const result = validateBulkRecord(bulkAttention(record), record);
  return result ? [result] : [];
};

describe("bulkConfirmPlan", () => {
  it.each(ATTENTION_SOURCE_KINDS)("checks full records for %s", (sourceKind) => {
    const record = sourceKind === "issue_thread_interaction" ? bulkQuestions() : bulkApproval();
    const hydrated = validateBulkRecord(bulkAttention(record, sourceKind), record);
    expect(bulkConfirmPlan(hydrated ? [hydrated] : [])).toHaveLength(["approval", "issue_thread_interaction"].includes(sourceKind) ? 1 : 0);
  });

  it("plans exact actions from mixed records, ignoring duplicates and non-hire approvals", () => {
    const hire = bulkApproval();
    const other = { ...bulkApproval("other"), type: "budget_override_required" as const };
    const records = [...validated(hire), ...validated(other), ...validated(bulkQuestions()), ...validated(hire)];
    const plan = bulkConfirmPlan(records);
    expect(plan.map((entry) => entry.action)).toEqual([
      { kind: "approve_hire", approvalId: hire.id },
      { kind: "answer_questions", issueId: "issue-1", interactionId: "questions-1", answers: [{ questionId: "model", optionIds: ["a"] }] },
    ]);
    expect(plan[0].answers).toEqual(["Approve hire: Specialist hire-1"]);
    expect(plan[1].answers[0]).toContain("Gemini Flash-Lite (recommended)");
  });

  it.each(["approved", "rejected", "revision_requested"] as const)("excludes %s hires", (status) => {
    expect(bulkConfirmPlan(validated({ ...bulkApproval(), status }))).toEqual([]);
  });

  it("requires an explicit recommendation on every question, never label hints or first options", () => {
    const questions = bulkQuestions();
    questions.payload.questionSet!.questions[0].options![0].recommended = false;
    questions.payload.questions[0].options[0].label = "Recommended default answer";
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
    delete questions.payload.questionSet;
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
    const multiple = bulkQuestions();
    multiple.payload.questions.push({ ...multiple.payload.questions[0], id: "second" });
    multiple.payload.questionSet!.questions.push({ ...multiple.payload.questionSet!.questions[0], id: "second", options: [{ id: "a", label: "Gemini Flash-Lite" }, { id: "b", label: "Another model" }] });
    expect(bulkConfirmPlan(validated(multiple))).toEqual([]);
  });

  it("requires an unambiguous single choice, supports explicit multi-select sets, and rejects free text", () => {
    const questions = bulkQuestions();
    questions.payload.questionSet!.questions[0].options![1].recommended = true;
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
    questions.payload.questions[0].selectionMode = "multi";
    questions.payload.questionSet!.questions[0].answerMode = "multi_select";
    expect(bulkConfirmPlan(validated(questions))[0].action).toMatchObject({ answers: [{ optionIds: ["a", "b"] }] });
    questions.payload.questions[0].options[0].freeText = true;
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
    questions.payload.questionSet!.questions[0].answerMode = "text";
    delete questions.payload.questionSet!.questions[0].options;
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
  });

  it("excludes answers larger than the existing response API accepts", () => {
    const questions = bulkQuestions();
    const legacy = questions.payload.questions[0];
    const canonical = questions.payload.questionSet!.questions[0];
    questions.payload.questions = Array.from({ length: 21 }, (_, index) => ({ ...legacy, id: `q${index}` }));
    questions.payload.questionSet!.questions = Array.from({ length: 21 }, (_, index) => ({ ...canonical, id: `q${index}` }));
    expect(bulkConfirmPlan(validated(questions))).toEqual([]);
  });

  it("rejects malformed, mismatched and cross-company records", () => {
    const record = bulkQuestions();
    const item = bulkAttention(record);
    for (const override of [{ companyId: "other" }, { issueId: "other" }, { id: "other" }, { payload: {} }]) {
      expect(validateBulkRecord(item, { ...record, ...override })).toBeNull();
    }
    record.payload.questionSet!.questions[0].options![0].label = "Changed answer";
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
  });

  it.each(["toolAction", "secretProposal", "connectionAuthorization"])("never strips governed marker %s before checking", (marker) => {
    const record = bulkQuestions();
    expect(validateBulkRecord(bulkAttention(record), { ...record, payload: { ...record.payload, [marker]: {} } })).toBeNull();
  });

  it.each([undefined, "native_completion_review", "plan", "tool-action:123", "connection:github:user:123", "unknown", "approve_merge"])("excludes unaudited/review confirmation target %s", (key) => {
    const record = { ...pendingRequestConfirmationInteraction,
      payload: { version: 1 as const, prompt: "Confirm?", ...(key ? { target: { type: "custom" as const, key } } : {}) } };
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
    expect(BULK_CONFIRM_TARGET_ALLOWLIST).toEqual([]);
  });

  it("also excludes checkbox reviews despite valid default selections", () => {
    const record = { ...pendingRequestConfirmationInteraction, kind: "request_checkbox_confirmation" as const, result: null,
      payload: { version: 1 as const, prompt: "Approve reviews?", options: [{ id: "a", label: "Review" }],
        defaultSelectedOptionIds: ["a"], minSelected: 1, maxSelected: 1 } };
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
  });
});

describe("hydration and sequential execution", () => {
  it("groups interactions by issue, bounds concurrency, and excludes failed hydration", async () => {
    let active = 0;
    let peak = 0;
    const records = Array.from({ length: 8 }, (_, index) => ({ ...bulkQuestions(`q${index}`), issueId: `issue-${Math.floor(index / 2)}` }));
    const interactions = vi.spyOn(issuesApi, "listInteractions").mockImplementation(async (issueId) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return records.filter((record) => record.issueId === issueId);
    });
    vi.spyOn(approvalsApi, "get").mockRejectedValue(new Error("offline"));
    const hire = bulkApproval();
    const hydrated = await hydrateBulkItems("company-1", [...records.map((record) => bulkAttention(record)), bulkAttention(hire)]);
    expect(interactions).toHaveBeenCalledTimes(4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(hydrated.records).toHaveLength(8);
    expect(hydrated.unavailableIds).toEqual([bulkAttention(hire).id]);
  });

  it("continues after failure, skips changed records, rechecks before every write, and submits exact answers", async () => {
    const hires = [bulkApproval("one"), bulkApproval("changed"), bulkApproval("failure"), bulkApproval("last")];
    const questions = bulkQuestions();
    const records: HydratedBulkRecord[] = [...hires.flatMap(validated), ...validated(questions)];
    const calls: string[] = [];
    vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => {
      calls.push(`read:${id}`);
      const record = hires.find((hire) => hire.id === id)!;
      return id === "changed" ? { ...record, payload: { name: "Changed" } } : record;
    });
    vi.spyOn(approvalsApi, "approve").mockImplementation(async (id) => {
      calls.push(`write:${id}`);
      if (id === "failure") throw new Error("Permission denied");
      return { ...hires.find((hire) => hire.id === id)!, status: "approved" };
    });
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([questions]);
    const respond = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...questions, status: "answered" });
    const progress = vi.fn();
    const result = await runBulkConfirm("company-1", bulkConfirmPlan(records), progress);
    expect(result).toEqual({ confirmed: 3, skipped: 1, failures: [{ title: "Question failure", reason: "Permission denied" }] });
    expect(calls).toEqual(["read:one", "write:one", "read:changed", "read:failure", "write:failure", "read:last", "write:last"]);
    expect(progress.mock.calls.flat()).toEqual([1, 2, 3, 4, 5]);
    expect(respond).toHaveBeenCalledWith("issue-1", questions.id, { answers: [{ questionId: "model", optionIds: ["a"] }] });
  });
});
