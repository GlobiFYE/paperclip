import { describe, expect, it } from "vitest";
import { taskBudgetCreateSchema, taskBudgetPatchSchema } from "./validators/task-budget.js";
import { createIssueSchema } from "./validators/issue.js";
import { resolveBudgetIncidentSchema } from "./validators/budget.js";

describe("task budget contracts", () => {
  it("accepts either metric and token limits beyond int32", () => {
    expect(taskBudgetCreateSchema.parse({ maxTokens: 5000000000 })).toEqual({ maxTokens: 5000000000 });
    expect(resolveBudgetIncidentSchema.parse({ action: "raise_budget_and_resume", amount: 5000000000 }).amount).toBe(5000000000);
    expect(createIssueSchema.parse({ title: "Funded task", budget: { maxCostCents: 2000, maxTokens: 500000 } }).budget)
      .toEqual({ maxCostCents: 2000, maxTokens: 500000 });
  });
  it.each([{}, { maxTokens: 0 }, { maxTokens: -1 }, { maxTokens: 1.5 }, { maxTokens: Number.MAX_SAFE_INTEGER + 1 }, { maxCostCents: null }])("rejects an invalid creation cap %j", value => {
    expect(taskBudgetCreateSchema.safeParse(value).success).toBe(false);
  });
  it("requires revisions for every changed metric and permits explicit removal", () => {
    expect(taskBudgetPatchSchema.safeParse({ maxTokens: 100, expectedRevisions: {} }).success).toBe(false);
    expect(taskBudgetPatchSchema.safeParse({ maxTokens: 100, maxCostCents: 10, expectedRevisions: { total_tokens: 0 } }).success).toBe(false);
    expect(taskBudgetPatchSchema.parse({ maxTokens: null, expectedRevisions: { total_tokens: 2 } }).maxTokens).toBeNull();
  });
});
