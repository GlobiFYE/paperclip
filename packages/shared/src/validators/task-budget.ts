import { z } from "zod";

const positiveAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const taskBudgetCreateSchema = z.object({
  maxCostCents: positiveAmount.optional(),
  maxTokens: positiveAmount.optional(),
}).strict().refine(value => value.maxCostCents !== undefined || value.maxTokens !== undefined,
  "Provide a dollar or token limit");

export const taskBudgetPatchSchema = z.object({
  maxCostCents: positiveAmount.nullable().optional(),
  maxTokens: positiveAmount.nullable().optional(),
  expectedRevisions: z.object({ billed_cents: revision.optional(), total_tokens: revision.optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.maxCostCents === undefined && value.maxTokens === undefined) {
    ctx.addIssue({ code: "custom", message: "Provide a budget change" });
  }
  for (const [field, metric] of [["maxCostCents", "billed_cents"], ["maxTokens", "total_tokens"]] as const) {
    if (value[field] !== undefined && value.expectedRevisions[metric] === undefined) {
      ctx.addIssue({ code: "custom", path: ["expectedRevisions", metric], message: "Expected revision is required" });
    }
  }
});
