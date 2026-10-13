import { describe, expect, it } from "vitest";
import { ATTENTION_SOURCE_KINDS } from "@paperclipai/shared";
import { bulkApproval, bulkAttention, bulkOwnerConfirmation, bulkQuestions } from "../../fixtures/bulkConfirmFixtures";
import { bulkConfirmPlan } from "../../lib/bulk-confirm";
import { classifyDecision, validateDecisionRecord } from "./classifyDecision";

import { plainDecision } from "./testFixtures";

const classify = (record: ReturnType<typeof bulkApproval> | ReturnType<typeof bulkQuestions> | ReturnType<typeof bulkOwnerConfirmation>) => {
  const item = bulkAttention(record);
  return classifyDecision(item, validateDecisionRecord(item, record));
};
describe("individual classification is closed and independent of bulk recommendations", () => {
  it("classifies hiring, owner confirmations and non-recommended questions", () => {
    expect(classify(bulkApproval())).toBe("hiring");
    expect(classify(bulkOwnerConfirmation())).toBe("yesno");
    const question = bulkQuestions();
    delete question.payload.questionSet;
    expect(classify(question)).toBe("question");
    const full = validateDecisionRecord(bulkAttention(question), question)!;
    expect(full.kind !== "decision" && bulkConfirmPlan([full])).toEqual([]);
  });
  it.each(ATTENTION_SOURCE_KINDS)("keeps unloaded %s in the full view", (kind) => {
    expect(classifyDecision(bulkAttention(bulkApproval(), kind), null)).toBe("closer_look");
  });
  it("rejects budget approvals, terminal hires, unknown audience and mismatched company", () => {
    expect(classify({ ...bulkApproval(), type: "budget_override_required" })).toBe("closer_look");
    expect(classify({ ...bulkApproval(), status: "rejected" })).toBe("closer_look");
    expect(classify({ ...bulkQuestions(), addresseeUserId: "someone-else" })).toBe("closer_look");
    const item = bulkAttention(bulkApproval());
    expect(validateDecisionRecord(item, { ...bulkApproval(), companyId: "other" })).toBeNull();
  });
  it.each(["toolAction", "secretProposal", "connectionAuthorization"])("keeps %s in full controls", (key) => {
    const record = bulkOwnerConfirmation();
    Object.assign(record.payload, { [key]: {} });
    expect(classify(record)).toBe("closer_look");
  });
  it("requires all owner eligibility flags and rejects unknown keys and connection questions", () => {
    for (const flags of [{ ownerDecision: false }, { governed: true }, { unknownKeys: true }]) {
      const record = bulkOwnerConfirmation();
      Object.assign(record.bulkEligibility!, flags);
      expect(classify(record)).toBe("closer_look");
    }
    const record = bulkQuestions();
    record.bulkEligibility!.unknownKeys = true;
    expect(classify(record)).toBe("closer_look");
    record.bulkEligibility!.unknownKeys = false;
    record.payload.questions[0].id = "connection-provider:one";
    expect(classify(record)).toBe("closer_look");
  });
  it("accepts up to 20 questions but leaves larger requests in the full card", () => {
    const record = bulkQuestions();
    delete record.payload.questionSet;
    record.payload.questions = Array.from({ length: 20 }, (_, i) => ({ ...record.payload.questions[0], id: `q${i}` }));
    expect(classify(record)).toBe("question");
    record.payload.questions.push({ ...record.payload.questions[0], id: "q20" });
    expect(classify(record)).toBe("closer_look");
  });
  it("accepts the real outcome response's opaque signedSpec without allowing unknown fields", () => {
    const record = plainDecision();
    const item = bulkAttention(bulkApproval(record.id), "decision");
    item.subject.kind = "decision";
    expect(record.signedSpec).toBe("opaque-server-signature");
    expect(classifyDecision(item, validateDecisionRecord(item, record))).toBe("question");
    expect(classifyDecision(item, validateDecisionRecord(item, { ...record, futureExecutionFlag: true }))).toBe("closer_look");
  });
  it("only permits explicitly plain standalone choices", () => {
    const item = bulkAttention(bulkApproval("decision-1"), "decision");
    item.subject.kind = "decision";
    const record = plainDecision();
    const category = (value: unknown) => classifyDecision(item, validateDecisionRecord(item, value));
    expect(category(record)).toBe("question");
    for (const patch of [
      { metadata: { special: true } }, { typedConfirmation: "confirm" }, { inputs: [{ id: "why", required: true }] },
      { options: [{ id: "cancel", label: "Cancel", style: "destructive", effects: [] }] },
      { options: [{ id: "run", label: "Run", effects: [{ type: "cancel_issue_tree" }] }] },
      { targetSnapshots: { issue: { descendantCount: 3 } } }, { status: "decided" }, { options: [{ id: "x", label: "X", effects: [], executable: true }] },
    ]) expect(category({ ...record, ...patch })).toBe("closer_look");
    item.decisionVerbs = [{ id: "cancel", label: "Cancel", description: "Cancel tree" }];
    expect(category(record)).toBe("closer_look");
  });
});
