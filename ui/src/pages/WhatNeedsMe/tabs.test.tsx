// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { within, userEvent } from "storybook/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ATTENTION_SOURCE_KINDS, type AttentionItem } from "@paperclipai/shared";
import { WhatNeedsMe } from "../WhatNeedsMe";
import { defaultDecisionTab } from "./DecisionTabs";
import { attentionApi } from "../../api/attention";
import { approvalsApi } from "../../api/approvals";
import { decisionsApi } from "../../api/decisions";
import { plainDecision } from "./testFixtures";
import { issuesApi } from "../../api/issues";
import { agentsApi } from "../../api/agents";
import { authApi } from "../../api/auth";
import { accessApi } from "../../api/access";
import { bulkApproval, bulkAttention, bulkOwnerConfirmation, bulkQuestions } from "../../fixtures/bulkConfirmFixtures";
const context = vi.hoisted(() => ({ setBreadcrumbs: vi.fn(), dismiss: vi.fn(), snooze: vi.fn(), restore: vi.fn(), pushToast: vi.fn() }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "ACME" } }) }));
vi.mock("../../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => context }));
vi.mock("../../context/ToastContext", () => ({ useToastActions: () => context }));
vi.mock("../../hooks/useInboxBadge", () => ({ useInboxDismissals: () => context }));
vi.mock("../../components/DecisionQueueRail", () => ({ DecisionQueueRail: () => null }));
vi.mock("../../components/DecisionDateChips", () => ({ DecisionDateChips: () => null }));
vi.mock("../../components/DecisionResolver", () => ({ DecisionResolver: () => null }));
vi.mock("../../components/DecisionShelf", () => ({ Curtain: () => null, AgingItemRow: () => null }));
vi.mock("../../components/DecisionsToolbar", () => ({ DecisionsToolbar: () => null }));
vi.mock("../../components/AttentionQueueRow", () => ({ AttentionQueueRow: ({ item, expanded }: { item: AttentionItem; expanded: boolean }) => <p data-testid={item.id} data-expanded={expanded}>Full controls: {item.subject.title}</p> }));
let root: Root, container: HTMLDivElement, client: QueryClient;
const ui = () => within(document.body);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); }); }
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
async function mount(path = "/ACME/decisions") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><WhatNeedsMe /><Location /></MemoryRouter></QueryClientProvider>));
  await settle(); await settle();
}
const a = bulkApproval(), c = bulkOwnerConfirmation(), q = bulkQuestions();
const items = [bulkAttention(a), bulkAttention(c), bulkAttention(q), bulkAttention({ ...bulkApproval("budget"), type: "budget_override_required" })];
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  vi.spyOn(agentsApi, "list").mockResolvedValue([]);
  vi.spyOn(authApi, "getSession").mockResolvedValue(null);
  vi.spyOn(accessApi, "listUserDirectory").mockResolvedValue({ users: [] });
  vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => id === a.id ? a : { ...bulkApproval("budget"), type: "budget_override_required" });
  vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([c, q]);
  vi.spyOn(attentionApi, "list").mockResolvedValue({ companyId: "company-1", generatedAt: "2026-10-12T12:00:00Z", items, totalCount: 4,
    deskBadgeCount: 4, nextCursor: null, countsBySourceKind: Object.fromEntries(ATTENTION_SOURCE_KINDS.map((kind) => [kind, 0])) as never });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });
it("shows all tab counts, picks Hiring by default and persists the URL", async () => {
  await mount();
  for (const label of ["Hiring 1", "Yes / No 1", "Questions 1", "Needs a closer look 1", "All 4"]) expect(ui().getByRole("tab", { name: label })).toBeTruthy();
  expect(ui().getByRole("tab", { name: "Hiring 1" }).getAttribute("aria-selected")).toBe("true");
  expect(ui().getByTestId("location").textContent).toBe("?tab=hiring");
  expect(ui().getByRole("tablist").className).toContain("flex-wrap");
  await act(async () => userEvent.click(ui().getByRole("tab", { name: "Questions 1" })));
  expect(ui().getByTestId("location").textContent).toBe("?tab=questions");
  expect(ui().getByRole("heading", { name: "Which model should I use?" })).toBeTruthy();
});
it("honors a saved tab and retains full controls for ineligible items", async () => {
  await mount("/ACME/decisions?tab=closer_look");
  expect(ui().getByText("Full controls: Question budget")).toBeTruthy();
  expect(ui().queryByText(`Full controls: Question ${a.id}`)).toBeNull();
  await act(async () => userEvent.click(ui().getByRole("tab", { name: "All 4" })));
  expect(ui().getByText(`Full controls: Question ${a.id}`)).toBeTruthy();
});
it("defaults in order and treats hydration failures as closer look", async () => {
  expect(defaultDecisionTab({ hiring: 0, yesno: 2, question: 3, closer_look: 1 })).toBe("yesno");
  expect(defaultDecisionTab({ hiring: 0, yesno: 0, question: 3, closer_look: 1 })).toBe("questions");
  expect(defaultDecisionTab({ hiring: 0, yesno: 0, question: 0, closer_look: 1 })).toBe("questions");
  vi.mocked(approvalsApi.get).mockRejectedValue(new Error("Unavailable"));
  await mount();
  expect(ui().getByRole("tab", { name: "Hiring 0" })).toBeTruthy();
  expect(ui().getByRole("tab", { name: "Needs a closer look 2" })).toBeTruthy();
  expect(ui().getByRole("tab", { name: "Yes / No 1" }).getAttribute("aria-selected")).toBe("true");
});
it("keeps hire bulk snapshots restricted to the Hiring tab", async () => {
  const second = bulkApproval("second");
  vi.mocked(approvalsApi.get).mockImplementation(async (id) => id === second.id ? second : a);
  const feed = await attentionApi.list("company-1");
  vi.mocked(attentionApi.list).mockResolvedValue({ ...feed, items: [...items.slice(0, 3), bulkAttention(second)] });
  await mount(); await settle();
  await act(async () => userEvent.click(ui().getByRole("button", { name: "Approve all (2)" })));
  const dialog = ui().getByRole("dialog");
  expect(dialog.textContent).toContain("Specialist second");
  expect(dialog.textContent).not.toContain(c.payload.prompt);
  expect(dialog.textContent).not.toContain(q.payload.questions[0].prompt);
});
it("refreshes counts after approval without changing the selected tab", async () => {
  const feed = await attentionApi.list("company-1");
  vi.spyOn(approvalsApi, "approve").mockImplementation(async () => {
    vi.mocked(attentionApi.list).mockResolvedValue({ ...feed, items: items.slice(1), generatedAt: "2026-10-12T12:01:00Z" });
    return { ...a, status: "approved" };
  });
  await mount();
  await act(async () => userEvent.click(ui().getByRole("button", { name: "Approve" })));
  await settle();
  expect(ui().getByRole("tab", { name: "Hiring 0" }).getAttribute("aria-selected")).toBe("true");
  expect(ui().getByRole("tab", { name: "All 3" })).toBeTruthy();
  expect(ui().getByText("All caught up")).toBeTruthy();
});

it("keeps a deep-linked full card expanded when hydration finishes after the feed", async () => {
  const record = plainDecision();
  const target = bulkAttention(bulkApproval(record.id), "decision"); target.subject.kind = "decision";
  const feed = await attentionApi.list("company-1");
  vi.mocked(attentionApi.list).mockResolvedValue({ ...feed, items: [...items, target] });
  let finishHydration!: (value: typeof record) => void;
  const hydration = new Promise<typeof record>((resolve) => { finishHydration = resolve; });
  const read = vi.spyOn(decisionsApi, "get").mockReturnValue(hydration);
  await mount(`/ACME/decisions?decisionId=${record.id}`);
  expect(read).toHaveBeenCalledWith(record.id);
  expect(ui().getByTestId("location").textContent).toBe("?tab=all");
  expect(ui().getByRole("tab", { name: "All 5" }).getAttribute("aria-selected")).toBe("true");
  const fullCard = ui().getByTestId(target.id);
  expect(fullCard.getAttribute("data-expanded")).toBe("true");
  await act(async () => finishHydration(record)); await settle();
  expect(ui().getByRole("tab", { name: "Hiring 1" })).toBeTruthy();
  expect(ui().getByRole("tab", { name: "Questions 2" })).toBeTruthy();
  expect(ui().getByRole("tab", { name: "All 5" }).getAttribute("aria-selected")).toBe("true");
  expect(ui().getByTestId(target.id)).toBe(fullCard);
  expect(fullCard.getAttribute("data-expanded")).toBe("true");
});
