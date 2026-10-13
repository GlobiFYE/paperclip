import { describe, expect, it, vi } from "vitest";
import { aggregatorProviderQuestion, ISSUE_STATUSES } from "@paperclipai/shared";
import { issues, issueThreadInteractions } from "@paperclipai/db";
import { interactionBulkEligibility } from "../services/interaction-bulk-eligibility.js";
import { hydrateInteraction, issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { isIssueReviewVerdictInteraction } from "../services/issue-review-policy.js";

const payload = { version: 1, prompt: "Use the short report?", target: { type: "custom", key: "owner_decision" } };
const activeIssue = { status: "in_progress", workMode: "standard" };
function row(rawPayload: unknown, extra = {}) {
  return {
    id: "interaction-1", companyId: "company-1", issueId: "issue-1", kind: "request_confirmation",
    status: "pending", payload: rawPayload, result: null, requestedResolverPolicy: "anyone",
    effectiveResolverPolicy: "anyone", resolverPolicyProvenance: "explicit",
    effectiveResolverPolicySource: "requested", ...extra,
  } as Parameters<typeof hydrateInteraction>[0];
}

describe("raw stored confirmation bulk eligibility", () => {
  it.each(["planning", "skill_test", undefined, null, "unknown"])("fails closed for owner confirmations with parent work mode %s", (workMode) => {
    expect(hydrateInteraction(row(payload), { ...activeIssue, workMode }).bulkEligibility)
      .toMatchObject({ ownerDecision: true, governed: true });
  });

  it.each(["standard", "ask"])("allows only the approved parent statuses in work mode %s", (workMode) => {
    for (const status of [...ISSUE_STATUSES, undefined, null, "unknown"]) {
      expect(hydrateInteraction(row(payload), { status, workMode }).bulkEligibility)
        .toEqual({ ownerDecision: true, governed: !["todo", "in_progress", "blocked"].includes(status ?? ""), unknownKeys: false });
    }
  });

  it("fails closed when the parent issue context is missing", () => {
    expect(hydrateInteraction(row(payload)).bulkEligibility?.governed).toBe(true);
  });

  it.each(["request_confirmation", "request_checkbox_confirmation"])("marks every %s on an in-review issue governed", (kind) => {
    expect(interactionBulkEligibility(row(payload, { kind }), { status: "in_review", workMode: "standard" }).governed).toBe(true);
  });

  it.each([
    { actorType: "agent", binding: "explicit" }, { actorType: "user", binding: "explicit" },
    { actorType: "agent", binding: "legacy" }, { actorType: "user", binding: "legacy" },
    { actorType: "agent", binding: "unattributed" },
  ])("excludes an owner confirmation consumed as a $binding review verdict by $actorType", async ({ actorType, binding }) => {
    const confirmation = row(payload, {
      createdByAgentId: binding !== "unattributed" && actorType === "agent" ? "reviewer" : null,
      createdByUserId: binding !== "unattributed" && actorType === "user" ? "reviewer" : null,
    });
    const parentIssue = { id: "issue-1", companyId: "company-1", status: "in_review", workMode: "standard" };
    const transition = { actorType, actorId: "reviewer", details: {
      status: "in_review", _previous: { status: "in_progress" },
      ...(binding === "explicit" ? { reviewInteractionId: confirmation.id } : {}),
    } };
    const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [transition] }) }) }) }) };
    expect(await isIssueReviewVerdictInteraction(db as unknown as Parameters<typeof isIssueReviewVerdictInteraction>[0],
      { issue: parentIssue, interaction: confirmation })).toBe(true);
    expect(hydrateInteraction(confirmation, parentIssue).bulkEligibility)
      .toMatchObject({ ownerDecision: true, governed: true });
  });

  it("marks plan-targeted confirmations governed even on a standard issue", () => {
    const plan = { ...payload, target: { type: "issue_document", key: "plan", revisionId: "11111111-1111-4111-8111-111111111111" } };
    expect(hydrateInteraction(row(plan), activeIssue).bulkEligibility?.governed).toBe(true);
  });

  it.each(["planning", "in_review"])("listForIssue reads parent context again when it changes to %s", async (change) => {
    const parentIssue = { ...activeIssue };
    const select = vi.fn((columns?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === issueThreadInteractions) return { orderBy: async () => [row(payload)] };
          expect(table).toBe(issues);
          expect(columns).toEqual({ status: issues.status, workMode: issues.workMode });
          return Promise.resolve([{ ...parentIssue }]);
        },
      }),
    }));
    const service = issueThreadInteractionService({ select } as unknown as Parameters<typeof issueThreadInteractionService>[0]);
    expect((await service.listForIssue("issue-1"))[0].bulkEligibility?.governed).toBe(false);
    if (change === "planning") parentIssue.workMode = "planning";
    else parentIssue.status = "in_review";
    expect((await service.listForIssue("issue-1"))[0].bulkEligibility?.governed).toBe(true);
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("classifies provider consent with an explicit recommended questionSet as governed during hydration", () => {
    const question = aggregatorProviderQuestion("notion", "Notion", []);
    question.options.unshift({ id: "via:composio:notion", label: "Composio — Recommended" });
    const raw = { version: 1, questions: [question], questionSet: {
      schema: "paperclip.question_set.v1", questions: [{ id: question.id, prompt: question.prompt,
        answerMode: "single_select", required: true,
        options: question.options.map((option, index) => ({ ...option, recommended: index === 0 })) }],
    } };
    const hydrated = hydrateInteraction(row(raw, { kind: "ask_user_questions" }));
    expect(hydrated.payload).toMatchObject({ questionSet: { questions: [{ options: [{ recommended: true }, {}] }] } });
    expect(hydrated.bulkEligibility).toMatchObject({ ownerDecision: false, governed: true });
  });

  it.each(["questions", "questionSet"])("checks provider consent in raw %s before normalizing", (location) => {
    const questions = [{ id: "connection-provider:github" }];
    const raw = location === "questions" ? { questions } : { questionSet: { questions } };
    expect(interactionBulkEligibility(row(raw, { kind: "ask_user_questions" })).governed).toBe(true);
  });

  it.each(["toolAction", "secretProposal", "connectionAuthorization"])("keeps question %s exclusions after schema stripping", (marker) => {
    const raw = { version: 1, questions: [{ id: "format", prompt: "Which format?", selectionMode: "single",
      options: [{ id: "short", label: "Short" }] }], [marker]: {} };
    const hydrated = hydrateInteraction(row(raw, { kind: "ask_user_questions" }));
    expect(hydrated.payload).not.toHaveProperty(marker);
    expect(hydrated.bulkEligibility).toMatchObject({ ownerDecision: false, governed: true });
  });
  it("returns eligibility with the normal hydrated owner confirmation", () => {
    expect(hydrateInteraction(row(payload), activeIssue)).toMatchObject({
      bulkEligibility: { ownerDecision: true, governed: false, unknownKeys: false }, payload,
    });
  });

  it.each(["connectionAuthorization", "reviewVerdict", "verdicts", "nativeReviewDecisionId", "bulkEligibility"])(
    "preserves the exclusion for raw %s even though hydration strips it", (marker) => {
      const hydrated = hydrateInteraction(row({ ...payload, [marker]: {} }), activeIssue);
      expect(hydrated.payload).not.toHaveProperty(marker);
      expect(hydrated.bulkEligibility).toMatchObject({ ownerDecision: false, unknownKeys: true });
      expect(hydrated.bulkEligibility?.governed).toBe(marker === "connectionAuthorization");
    },
  );

  it("detects target metadata before the nested schema strips it", () => {
    const hydrated = hydrateInteraction(row({ ...payload, target: { ...payload.target, reviewVerdict: "approve" } }));
    expect(hydrated.payload).toMatchObject({ target: payload.target });
    expect(hydrated.payload).not.toHaveProperty("target.reviewVerdict");
    expect(hydrated.bulkEligibility).toMatchObject({ ownerDecision: false, unknownKeys: true });
  });

  it.each(["toolAction", "secretProposal", "connectionAuthorization"])("detects even a null raw %s marker", (marker) => {
    expect(interactionBulkEligibility(row({ ...payload, [marker]: null })).governed).toBe(true);
  });

  it("detects governed policy even without a payload marker", () => {
    expect(hydrateInteraction(row(payload, { effectiveResolverPolicySource: "governed_action" })).bulkEligibility)
      .toEqual({ ownerDecision: true, governed: true, unknownKeys: false });
  });

  it.each(["native_completion_review", "unknown", "plan"])("does not allow custom target %s", (key) => {
    expect(hydrateInteraction(row({ ...payload, target: { type: "custom", key } })).bulkEligibility?.ownerDecision).toBe(false);
  });

  it("does not treat document or checkbox targets as owner confirmations", () => {
    expect(interactionBulkEligibility(row({ ...payload, target: { type: "issue_document", key: "owner_decision" } })).ownerDecision).toBe(false);
    expect(interactionBulkEligibility(row(payload, { kind: "request_checkbox_confirmation" })).ownerDecision).toBe(false);
  });
});
