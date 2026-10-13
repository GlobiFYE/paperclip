// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within, userEvent } from "storybook/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ATTENTION_SOURCE_KINDS, type AttentionItem } from "@paperclipai/shared";
import { AllDecisions as WhatNeedsMe } from "./WhatNeedsMe";
import { attentionApi } from "../api/attention";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { accessApi } from "../api/access";
import { bulkApproval, bulkAttention } from "../fixtures/bulkConfirmFixtures";
import type { AttentionFilterState } from "../lib/attention";

const context = vi.hoisted(() => ({
  setBreadcrumbs: vi.fn(), navigate: vi.fn(), setSearchParams: vi.fn(),
  dismiss: vi.fn(), snooze: vi.fn(), restore: vi.fn(), pushToast: vi.fn(),
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => context }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => context }));
vi.mock("../hooks/useInboxBadge", () => ({ useInboxDismissals: () => context }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => context.navigate,
  useSearchParams: () => [new URLSearchParams(), context.setSearchParams],
}));
vi.mock("../components/DecisionQueueRail", () => ({ DecisionQueueRail: () => null }));
vi.mock("../components/DecisionDateChips", () => ({ DecisionDateChips: () => null }));
vi.mock("../components/DecisionResolver", () => ({ DecisionResolver: () => null }));
vi.mock("../components/AttentionQueueRow", () => ({
  AttentionQueueRow: ({ item, onDismiss }: { item: AttentionItem; onDismiss: (item: AttentionItem) => void }) =>
    <div id={`attention-row-${item.id}`}>{item.subject.title}<button onClick={() => onDismiss(item)}>Dismiss {item.id}</button></div>,
}));
vi.mock("../components/DecisionShelf", () => ({ Curtain: () => null, AgingItemRow: () => null }));
// Exercise page-owned filters and the real BulkConfirm, without coupling this
// integration test to the toolbar's popover implementation.
vi.mock("../components/DecisionsToolbar", () => ({
  DecisionsToolbar: ({ filters, onFiltersChange }: {
    filters: AttentionFilterState; onFiltersChange: (filters: AttentionFilterState) => void;
  }) => <>
    <button onClick={() => onFiltersChange({ ...filters, severities: ["high"] })}>High priority only</button>
    <button onClick={() => onFiltersChange({ ...filters, severities: ["low"] })}>Low priority only</button>
    <button onClick={() => onFiltersChange({ ...filters, severities: [] })}>All priorities</button>
  </>,
}));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const ui = () => within(document.body);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}
async function click(name: string) {
  await act(async () => userEvent.click(ui().getByRole("button", { name })));
  await settle();
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(agentsApi, "list").mockResolvedValue([]);
  vi.spyOn(authApi, "getSession").mockResolvedValue(null);
  vi.spyOn(accessApi, "listUserDirectory").mockResolvedValue({ users: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("counts only the filtered active desk, excluding snoozed, dismissed and aging items", async () => {
  const records = ["high-one", "high-two", "low", "snoozed", "dismissed", "aging"].map(bulkApproval);
  const items = records.map((record, index) => ({ ...bulkAttention(record), severity: index === 2 ? "low" as const : "high" as const }));
  items[3].dismissal = { kind: "snooze", isActive: true, dismissedAt: "2026-10-12T00:00:00Z", snoozedUntil: "2026-10-13T00:00:00Z" };
  items[4].dismissal = { kind: "dismiss", isActive: true, dismissedAt: "2026-10-12T00:00:00Z", snoozedUntil: null };
  items[5].shelf = true;
  const feed = {
    companyId: "company-1", generatedAt: "2026-10-12T12:00:00Z", items, totalCount: items.length, deskBadgeCount: 3,
    nextCursor: null, countsBySourceKind: Object.fromEntries(ATTENTION_SOURCE_KINDS.map((kind) => [kind, kind === "approval" ? items.length : 0])) as Record<typeof ATTENTION_SOURCE_KINDS[number], number>,
  };
  vi.spyOn(attentionApi, "list").mockResolvedValue(feed);
  const read = vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => records.find((record) => record.id === id)!);
  await act(async () => root.render(<QueryClientProvider client={client}><WhatNeedsMe /></QueryClientProvider>));
  await settle();
  await settle();
  expect(ui().getByRole("button", { name: "Confirm all (3)" })).toBeTruthy();
  expect(read.mock.calls.map(([id]) => id).sort()).toEqual(["high-one", "high-two", "low"]);
  // A new feed timestamp alone does not hydrate the entire desk again.
  await act(async () => client.setQueryData(["attention", "company-1", "with-dismissed", null, null], {
    ...feed, generatedAt: "2026-10-12T12:01:00Z",
  }));
  await settle();
  expect(read).toHaveBeenCalledTimes(3);
  const initialButton = ui().getByRole("button", { name: "Confirm all (3)" });
  await click("High priority only");
  expect(ui().getByRole("button", { name: "Confirm all (2)" })).toBe(initialButton);
  expect(read).toHaveBeenCalledTimes(3);
  await click("Confirm all (2)");
  const dialog = ui().getByRole("dialog");
  expect(dialog.textContent).toContain("Specialist high-one");
  expect(dialog.textContent).toContain("Specialist high-two");
  for (const excluded of ["low", "snoozed", "dismissed", "aging"]) {
    expect(dialog.textContent).not.toContain(`Specialist ${excluded}`);
  }
  await click("Cancel");
  await click("Low priority only");
  expect(ui().queryByRole("button", { name: /Confirm all/ })).toBeNull();
  await click("All priorities");
  const restoredButton = ui().getByRole("button", { name: "Confirm all (3)" });
  expect(read).toHaveBeenCalledTimes(3);
  await click("Dismiss attention-low");
  expect(context.dismiss).toHaveBeenCalledWith("low");
  expect(ui().getByRole("button", { name: "Confirm all (2)" })).toBe(restoredButton);
  expect(read).toHaveBeenCalledTimes(3);
});
