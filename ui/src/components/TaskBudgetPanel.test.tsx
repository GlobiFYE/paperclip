// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { TaskBudgetSummary } from "@paperclipai/shared";
import { budgetsApi } from "../api/budgets";
import { queryKeys } from "../lib/queryKeys";
import { TaskBudgetPanel } from "./TaskBudgetPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/budgets", () => ({ budgetsApi: { task: vi.fn(), updateTask: vi.fn() } }));

it("keeps the edit's original revision when polling receives a concurrent change", async () => {
  const issueId = "task-fixture";
  const policy = { policyId: "policy", scopeId: issueId, metric: "billed_cents", amount: 2000,
    observedAmount: 0, remainingAmount: 2000, revision: 1, isActive: true, status: "ok",
    companyId: "company", scopeType: "issue", scopeName: "Fixture", windowKind: "lifetime",
    utilizationPercent: 0, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true, paused: false,
    pauseReason: null, windowStart: new Date(0), windowEnd: new Date("9999-01-01"),
    unpricedEventCount: 0, pendingRunCount: 0, unpricedUsagePolicy: "block" } as const;
  const summary = { issueId, companyId: "company", policies: [policy], ownPolicies: [policy],
    directUsage: { billedCents: 0, totalTokens: 0, incompleteCostRunIds: [], incompleteTokenRunIds: [] },
    descendantUsage: { billedCents: 0, totalTokens: 0, incompleteCostRunIds: [], incompleteTokenRunIds: [] },
    remaining: { billed_cents: 2000, total_tokens: null }, blockers: [], primaryBlocker: null,
    initialization: "ready", legacyAttribution: false, permissions: { billed_cents: { canSet: true, canIncrease: true, canRemove: true },
      total_tokens: { canSet: true, canIncrease: true, canRemove: true } },
  } as TaskBudgetSummary;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.budgets.task(issueId), summary);
  vi.mocked(budgetsApi.updateTask).mockRejectedValue(new Error("The task budget changed; reload before saving"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const button = (label: string) => [...container.querySelectorAll("button")].find(node => node.textContent === label)!;
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><TaskBudgetPanel issueId={issueId} /></MemoryRouter></QueryClientProvider>); });
    act(() => button("Edit").click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="Dollar limit (USD)"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "25.00");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      client.setQueryData(queryKeys.budgets.task(issueId), { ...summary,
        policies: [{ ...policy, amount: 3000, revision: 2 }], ownPolicies: [{ ...policy, amount: 3000, revision: 2 }] });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("$0.00 used / $30.00");
    expect(input.value).toBe("25.00");
    await act(async () => { button("Save budget").click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(budgetsApi.updateTask).toHaveBeenCalledWith(issueId, { maxCostCents: 2500, expectedRevisions: { billed_cents: 1 } });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed; reload");
  } finally {
    act(() => root.unmount());
    container.remove();
    client.clear();
  }
});
