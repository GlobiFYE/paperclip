import { describe, expect, it } from "vitest";
import { budgetInputValue, formatBudgetAmount, parseBudgetInput } from "./task-budget-format";

describe("task budget amounts", () => {
  it("keeps token counts separate from currency", () => {
    expect(formatBudgetAmount("total_tokens", 1000000)).toBe("1,000,000 tokens");
    expect(budgetInputValue("total_tokens", 123)).toBe("123");
    expect(budgetInputValue("billed_cents", 123)).toBe("1.23");
    expect(parseBudgetInput("billed_cents", "12.34")).toBe(1234);
    expect(parseBudgetInput("total_tokens", "5000000000")).toBe(5000000000);
  });
  it("rejects ambiguous fractions, unsafe amounts and nonpositive limits", () => {
    for (const invalid of ["", "0", "-1", "NaN", "1e3", "1.001", "9007199254740992"]) {
      expect(parseBudgetInput("total_tokens", invalid)).toBeNull();
    }
    expect(parseBudgetInput("billed_cents", "1.234")).toBeNull();
    expect(parseBudgetInput("total_tokens", "1.5")).toBeNull();
  });
});
