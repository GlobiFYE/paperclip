import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ATTENTION_SOURCE_KINDS, aggregatorProviderQuestion, askUserQuestionsPayloadSchema, createIssueThreadInteractionSchema, requestConfirmationPayloadSchema, type IssueThreadInteraction } from "@paperclipai/shared";
import { bulkApproval, bulkAttention, bulkOwnerConfirmation, bulkQuestions } from "../fixtures/bulkConfirmFixtures";
import { pendingRequestConfirmationInteraction } from "../fixtures/issueThreadInteractionFixtures";
import { BULK_CONFIRM_TARGET_ALLOWLIST, bulkConfirmPlan, recommendedQuestionAnswers, validateBulkRecord, type HydratedBulkRecord } from "./bulk-confirm";
import { hydrateBulkItems, runBulkConfirm } from "./bulk-confirm-api";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";

afterEach(() => vi.restoreAllMocks());
const validated = (record: ReturnType<typeof bulkApproval> | IssueThreadInteraction) => {
  const result = validateBulkRecord(bulkAttention(record), record);
  return result ? [result] : [];
};

describe("bulkConfirmPlan", () => {
  it.each([true, false])("excludes explicitly recommended provider consent even with server governed=%s", (governed) => {
    const question = aggregatorProviderQuestion("notion", "Notion", []);
    question.options.unshift({ id: "via:composio:notion", label: "Composio — Recommended" });
    const record = bulkQuestions();
    record.payload = askUserQuestionsPayloadSchema.parse({ version: 1, questions: [question], questionSet: {
      schema: "paperclip.question_set.v1", questions: [{ id: question.id, prompt: question.prompt,
        answerMode: "single_select", required: true,
        options: question.options.map((option, index) => ({ ...option, recommended: index === 0 })) }],
    } });
    record.bulkEligibility!.governed = governed;
    expect(record.payload.questionSet!.questions[0].options![0].recommended).toBe(true);
    expect(recommendedQuestionAnswers(record.payload)).toBeNull();
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
    // The matching payload would otherwise be bulk-eligible: the reserved id is the gate.
    record.payload.questions[0].id = "report-format";
    record.payload.questionSet!.questions[0].id = "report-format";
    expect(recommendedQuestionAnswers(record.payload)).not.toBeNull();
  });

  it.each(["toolAction", "secretProposal", "connectionAuthorization"])("excludes question marker %s stripped by the read schema", (marker) => {
    const record = bulkQuestions();
    const payload = askUserQuestionsPayloadSchema.parse({ ...record.payload, [marker]: {} });
    expect(payload).not.toHaveProperty(marker);
    expect(validateBulkRecord(bulkAttention(record), { ...record, payload,
      bulkEligibility: { ownerDecision: false, governed: true, unknownKeys: false } })).toBeNull();
  });

  it.each([undefined, {}, { ownerDecision: false }])("fails closed on missing question governed classification %j", (bulkEligibility) => {
    const record = bulkQuestions();
    expect(validateBulkRecord(bulkAttention(record), { ...record, bulkEligibility })).toBeNull();
  });
  it.each([undefined, { ownerDecision: true }, { ownerDecision: false, governed: false, unknownKeys: false },
    { ownerDecision: true, governed: true, unknownKeys: false }, { ownerDecision: true, governed: false, unknownKeys: true }])(
    "fails closed for missing, incomplete or unsafe server classification %j", (bulkEligibility) => {
      const record = bulkOwnerConfirmation();
      expect(validateBulkRecord(bulkAttention(record), { ...record, bulkEligibility })).toBeNull();
    },
  );

  it("excludes markers stripped by the real read schema using the server's raw-payload flags", () => {
    const record = bulkOwnerConfirmation();
    const payload = requestConfirmationPayloadSchema.parse({ ...record.payload,
      connectionAuthorization: {}, reviewVerdict: "approve",
      target: { ...record.payload.target, reviewVerdict: "approve" },
    });
    expect(payload).not.toHaveProperty("connectionAuthorization");
    expect(payload).not.toHaveProperty("target.reviewVerdict");
    expect(validateBulkRecord(bulkAttention(record), { ...record, payload,
      bulkEligibility: { ownerDecision: false, governed: true, unknownKeys: true } })).toBeNull();
  });

  it.each([bulkOwnerConfirmation, bulkQuestions])("enforces human resolver audience for %s", (fixture) => {
    const record = fixture();
    const item = bulkAttention(record);
    expect(validateBulkRecord(item, { ...record, addresseeUserId: "someone-else" }, "me")).toBeNull();
    expect(validateBulkRecord(item, { ...record, addresseeUserId: "me" }, "me")).not.toBeNull();
    expect(validateBulkRecord(item, { ...record, effectiveResolverPolicy: "not_creator", createdByUserId: "me" }, "me")).toBeNull();
    expect(validateBulkRecord(item, { ...record, effectiveResolverPolicy: "not_creator" }, null)).toBeNull();
    expect(validateBulkRecord(item, { ...record, effectiveResolverPolicy: "not_creator", createdByUserId: "someone-else" }, "me")).not.toBeNull();
    expect(validateBulkRecord(item, { ...record, effectiveResolverPolicy: "unknown" }, "me")).toBeNull();
    // Server policy explicitly allows a human to override an agent addressee.
    expect(validateBulkRecord(item, { ...record, effectiveResolverPolicy: "human_only", addresseeAgentId: "agent-1" }, "me")).not.toBeNull();
  });
  it.each(ATTENTION_SOURCE_KINDS)("checks full records for %s", (sourceKind) => {
    const record = sourceKind === "issue_thread_interaction" ? bulkQuestions() : bulkApproval();
    const hydrated = validateBulkRecord(bulkAttention(record, sourceKind), record);
    expect(bulkConfirmPlan(hydrated ? [hydrated] : [])).toHaveLength(["approval", "issue_thread_interaction"].includes(sourceKind) ? 1 : 0);
  });

  it("plans exact actions from mixed records, ignoring duplicates and non-hire approvals", () => {
    const hire = bulkApproval();
    const other = { ...bulkApproval("other"), type: "budget_override_required" as const };
    const records = [...validated(hire), ...validated(other), ...validated(bulkQuestions()), ...validated(hire), ...validated(bulkOwnerConfirmation())];
    const plan = bulkConfirmPlan(records);
    expect(plan.map((entry) => entry.action)).toEqual([
      { kind: "approve_hire", approvalId: hire.id },
      { kind: "answer_questions", issueId: "issue-1", interactionId: "questions-1", answers: [{ questionId: "model", optionIds: ["a"] }] },
      { kind: "accept_confirmation", issueId: "issue-1", interactionId: "owner-confirmation-1" },
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

  it("accepts the existing creation contract and plans a plain owner decision", () => {
    const record = bulkOwnerConfirmation();
    const input = createIssueThreadInteractionSchema.parse({ kind: record.kind, payload: record.payload });
    expect(input.payload).toMatchObject({ target: { type: "custom", key: "owner_decision" } });
    expect(BULK_CONFIRM_TARGET_ALLOWLIST).toEqual(["owner_decision"]);
    expect(bulkConfirmPlan(validated(record))[0]).toMatchObject({
      title: record.title, askedByAgentId: record.createdByAgentId,
      answers: ["Use a short weekly report? — Answer: Yes, use a short report"],
      action: { kind: "accept_confirmation", issueId: record.issueId, interactionId: record.id },
    });
  });

  it.each(["toolAction", "secretProposal", "connectionAuthorization", "reviewVerdict", "verdicts", "nativeReviewDecisionId"])(
    "excludes owner decisions carrying %s, even null metadata", (marker) => {
      const record = bulkOwnerConfirmation();
      for (const value of [{}, null]) {
        expect(validateBulkRecord(bulkAttention(record), { ...record, payload: { ...record.payload, [marker]: value } })).toBeNull();
      }
    },
  );

  it("excludes governed policies, document targets, and unknown target metadata even with the owner key", () => {
    const record = bulkOwnerConfirmation();
    expect(validateBulkRecord(bulkAttention(record), { ...record, effectiveResolverPolicySource: "governed_action" })).toBeNull();
    for (const target of [
      { type: "issue_document", key: "owner_decision", revisionId: "11111111-1111-4111-8111-111111111111" },
      { type: "custom", key: "owner_decision", reviewVerdict: "approve" },
    ]) {
      expect(validateBulkRecord(bulkAttention(record), { ...record, payload: { ...record.payload, target } })).toBeNull();
    }
  });

  it.each(["accepted", "rejected", "expired", "cancelled"] as const)("excludes %s owner confirmations", (status) => {
    expect(bulkConfirmPlan(validated({ ...bulkOwnerConfirmation(), status }))).toEqual([]);
  });

  it.each([undefined, "native_completion_review", "plan", "tool-action:123", "connection:github:user:123", "unknown", "approve_merge"])("excludes unaudited/review confirmation target %s", (key) => {
    const record = { ...pendingRequestConfirmationInteraction,
      payload: { version: 1 as const, prompt: "Confirm?", ...(key ? { target: { type: "custom" as const, key } } : {}) } };
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
  });

  it.each([undefined, "owner_decision"])("also excludes checkbox reviews despite valid defaults and target %s", (key) => {
    const record = { ...pendingRequestConfirmationInteraction, kind: "request_checkbox_confirmation" as const, result: null,
      payload: { version: 1 as const, prompt: "Approve reviews?", options: [{ id: "a", label: "Review" }],
        defaultSelectedOptionIds: ["a"], minSelected: 1, maxSelected: 1,
        ...(key ? { target: { type: "custom" as const, key } } : {}) } };
    expect(bulkConfirmPlan(validated(record))).toEqual([]);
  });
});

describe("hydration and sequential execution", () => {
  it.each(["planning", "in_review"])("skips an owner confirmation when revalidation reports its issue became %s", async (parentState) => {
    const record = bulkOwnerConfirmation();
    const plan = bulkConfirmPlan(validated(record));
    expect(plan).toHaveLength(1);
    // listInteractions classifies the current parent, independently of the old feed row.
    const governedRecord = { ...record, bulkEligibility: { ownerDecision: true, governed: true, unknownKeys: false } };
    const read = vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([governedRecord]);
    const accept = vi.spyOn(issuesApi, "acceptInteraction");
    expect(bulkConfirmPlan(validated(governedRecord)), parentState).toEqual([]);
    expect(await runBulkConfirm("company-1", plan, vi.fn())).toEqual({ confirmed: 0, skipped: 1, failures: [] });
    expect(accept).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(record.issueId);
  });

  it("reuses per-issue reads across desk membership changes and refreshes only a changed issue", async () => {
    const client = new QueryClient();
    try {
      const records = [bulkQuestions("first"), bulkQuestions("second"), { ...bulkQuestions("other"), issueId: "issue-2" }];
      const items = records.map((record) => bulkAttention(record));
      const read = vi.spyOn(issuesApi, "listInteractions").mockImplementation(async (id) => records.filter((record) => record.issueId === id));
      await hydrateBulkItems("company-1", items, "owner", client);
      expect(read).toHaveBeenCalledTimes(2);
      await hydrateBulkItems("company-1", items.slice(1), "owner", client);
      await hydrateBulkItems("company-1", items, "owner", client);
      expect(read).toHaveBeenCalledTimes(2);
      await hydrateBulkItems("company-1", items.map((item, index) => index === 0
        ? { ...item, updatedAt: "2026-10-12T01:00:00Z" } : item), "owner", client);
      expect(read.mock.calls.map(([id]) => id)).toEqual(["issue-1", "issue-2", "issue-1"]);
    } finally {
      client.clear();
    }
  });
  it("reports missing records as unavailable, distinct from known ineligible records", async () => {
    const records = [bulkOwnerConfirmation("missing"), bulkOwnerConfirmation("governed")];
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([
      { ...records[1], bulkEligibility: { ownerDecision: true, governed: true, unknownKeys: false } },
    ]);
    const hydrated = await hydrateBulkItems("company-1", records.map((record) => bulkAttention(record)));
    expect(hydrated).toEqual({ records: [], unavailableIds: [bulkAttention(records[0]).id] });
  });

  it("uses the current user again during submission revalidation", async () => {
    const record = { ...bulkOwnerConfirmation(), addresseeUserId: "owner" };
    const item = bulkAttention(record);
    const plan = bulkConfirmPlan([validateBulkRecord(item, record, "owner")!]);
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([record]);
    const accept = vi.spyOn(issuesApi, "acceptInteraction").mockResolvedValue({ ...record, status: "accepted" });
    expect((await runBulkConfirm("company-1", plan, vi.fn(), undefined, "owner")).confirmed).toBe(1);
    accept.mockClear();
    expect((await runBulkConfirm("company-1", plan, vi.fn(), undefined, "different-user")).skipped).toBe(1);
    expect(accept).not.toHaveBeenCalled();
  });
  it("does not read or write when cancelled before the run", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.spyOn(approvalsApi, "get");
    const write = vi.spyOn(approvalsApi, "approve");
    const progress = vi.fn();
    await runBulkConfirm("company-1", bulkConfirmPlan(validated(bulkApproval())), progress, controller.signal);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("checks cancellation again after revalidation and before writing", async () => {
    const record = bulkApproval();
    const controller = new AbortController();
    vi.spyOn(approvalsApi, "get").mockImplementation(async () => { controller.abort(); return record; });
    const write = vi.spyOn(approvalsApi, "approve");
    await runBulkConfirm("company-1", bulkConfirmPlan(validated(record)), vi.fn(), controller.signal);
    expect(write).not.toHaveBeenCalled();
  });

  it("avoids hydration for metadata that rules out eligibility", async () => {
    const hire = bulkApproval();
    const question = bulkQuestions();
    const excluded = [
      { ...bulkAttention(hire), subject: { ...bulkAttention(hire).subject, metadata: { type: "budget_override_required" } } },
      { ...bulkAttention(question), subject: { ...bulkAttention(question).subject, metadata: { kind: "request_item_verdicts" } } },
    ];
    const approvals = vi.spyOn(approvalsApi, "get");
    const interactions = vi.spyOn(issuesApi, "listInteractions");
    expect((await hydrateBulkItems("company-1", excluded)).records).toEqual([]);
    expect(approvals).not.toHaveBeenCalled();
    expect(interactions).not.toHaveBeenCalled();
  });

  it("rechecks owner confirmations, skips changed payloads, and continues after a failed acceptance", async () => {
    const records = ["changed", "failed", "accepted"].map(bulkOwnerConfirmation);
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue(records.map((record) => record.id === "changed"
      ? { ...record, payload: { ...record.payload, prompt: "Changed question?" } } : record));
    const accept = vi.spyOn(issuesApi, "acceptInteraction").mockImplementation(async (_issueId, id) => ({
      ...records.find((record) => record.id === id)!, status: id === "failed" ? "expired" : "accepted",
    }));
    const respond = vi.spyOn(issuesApi, "respondToInteraction");
    const result = await runBulkConfirm("company-1", bulkConfirmPlan(records.flatMap(validated)), vi.fn());
    expect(accept.mock.calls).toEqual([["issue-1", "failed"], ["issue-1", "accepted"]]);
    expect(respond).not.toHaveBeenCalled();
    expect(result).toEqual({ confirmed: 1, skipped: 1,
      failures: [{ title: "Choose the report format", reason: "Confirmation returned expired. Check it individually." }] });
  });

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
