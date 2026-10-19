import type { BudgetMetric } from "@paperclipai/shared";
import { formatCents } from "./utils";

export function formatBudgetAmount(metric: BudgetMetric, value: number) {
  return metric === "total_tokens" ? `${value.toLocaleString()} tokens` : formatCents(value);
}

export function budgetInputValue(metric: BudgetMetric, value: number) {
  return metric === "total_tokens" ? String(value) : (value / 100).toFixed(2);
}

export function parseBudgetInput(metric: BudgetMetric, value: string): number | null {
  if (!value.trim() || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  if (metric === "total_tokens" && !/^\d+$/.test(value.trim())) return null;
  const amount = metric === "total_tokens" ? Number(value) : Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
