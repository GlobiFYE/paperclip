// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval } from "@paperclipai/shared";
import { Approvals } from "./Approvals";
import { queryKeys } from "../lib/queryKeys";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(), list: vi.fn(), agents: vi.fn(), navigate: vi.fn(), breadcrumbs: vi.fn(),
  companyId: "company-1", pathname: "/approvals/pending",
}));
vi.mock("../api/approvals", () => ({ approvalsApi: { list: mocks.list, approve: mocks.approve, reject: vi.fn() } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: mocks.agents } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: mocks.companyId }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => mocks.navigate, useLocation: () => ({ pathname: mocks.pathname }) }));
vi.mock("../components/ApprovalCard", () => ({ ApprovalCard: ({ approval }: { approval: Approval }) => <article>{approval.id}</article> }));
vi.mock("../components/MarkdownBody", () => ({ MarkdownBody: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function hire(id: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id, companyId: "company-1", type: "hire_agent", status: "pending",
    payload: { name: id, title: `Title for ${id}` },
    requestedByAgentId: null, requestedByUserId: null, decisionNote: null,
    decidedByUserId: null, decidedAt: null,
    createdAt: new Date("2026-10-12"), updatedAt: new Date("2026-10-12"), ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let user: ReturnType<typeof userEvent.setup>;
async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function render(approvals: Approval[]) {
  mocks.list.mockResolvedValue(approvals);
  client.setQueryData(queryKeys.approvals.list(mocks.companyId), approvals);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Approvals /></QueryClientProvider>);
  });
  await flush();
}
async function click(element: HTMLElement) {
  await act(async () => { await user.click(element); });
  await flush();
}
async function open() {
  await click(screen.getByRole("button", { name: /^Approve all/ }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.companyId = "company-1";
  mocks.pathname = "/approvals/pending";
  mocks.agents.mockResolvedValue([]);
  mocks.approve.mockResolvedValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  user = userEvent.setup();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("Approvals bulk hiring", () => {
  it.each([0, 1])("hides Approve all with %i eligible hires", async (count) => {
    await render(Array.from({ length: count }, (_, i) => hire(`hire-${i}`)));
    expect(screen.queryByRole("button", { name: /^Approve all/ })).toBeNull();
  });

  it("hides Approve all on the All tab", async () => {
    mocks.pathname = "/approvals/all";
    await render([hire("Ada"), hire("Grace")]);
    expect(screen.queryByRole("button", { name: /^Approve all/ })).toBeNull();
  });

  it("does not count excluded types or revision requests toward the threshold", async () => {
    await render([
      hire("Ada"), hire("Budget", { type: "budget_override_required" }),
      hire("Tool", { type: "request_board_approval" }), hire("Revision", { status: "revision_requested" }),
    ]);
    expect(screen.queryByRole("button", { name: /^Approve all/ })).toBeNull();
  });

  it("lists type, name, title, and an id fallback in the dialog", async () => {
    await render([hire("Ada"), hire("missing-subject", { payload: {} })]);
    const dialog = await open();
    expect(within(dialog).getByText("Hire Agent: Title for Ada")).toBeTruthy();
    expect(within(dialog).getByText("Name: Ada")).toBeTruthy();
    expect(within(dialog).getByText("Title: Title for Ada")).toBeTruthy();
    expect(within(dialog).getByText("Hire Agent: missing-subject")).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("only approves pending hires from a mixed list and invalidates approvals and agents without navigation", async () => {
    await render([
      hire("Ada"), hire("Grace"), hire("Budget", { type: "budget_override_required" }),
      hire("Tool", { type: "request_board_approval", payload: { toolName: "delete_file", arguments: { path: "test" } } }),
      hire("Strategy", { type: "approve_ceo_strategy" }),
      hire("Revision", { status: "revision_requested" }), hire("Approved", { status: "approved" }),
    ]);
    expect(screen.getByRole("button", { name: "Approve all (2)" })).toBeTruthy();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const dialog = await open();
    expect(dialog.textContent).toContain("4 other approvals need individual review");
    expect(within(dialog).getByRole("link", { name: "View pending list" }).getAttribute("href")).toBe("#pending-approvals");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    await click(within(dialog).getByRole("button", { name: "Approve 2" }));
    expect(mocks.approve.mock.calls).toEqual([["Ada"], ["Grace"]]);
    expect(within(dialog).getByRole("status").textContent).toBe("2 approved, 0 failed");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.approvals.list("company-1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.agents.list("company-1") });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps the snapshot when new approvals arrive, submits sequentially, and shows progress", async () => {
    const initial = [hire("Ada"), hire("Grace")];
    await render(initial);
    const dialog = await open();
    await act(async () => { client.setQueryData(queryKeys.approvals.list("company-1"), [...initial, hire("New arrival")]); });
    await flush();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    mocks.approve.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
    const confirm = within(dialog).getByRole("button", { name: "Approve 2" });
    await click(confirm);
    await click(confirm);
    expect(mocks.approve.mock.calls).toEqual([["Ada"]]);
    expect(within(dialog).getByRole("status").textContent).toBe("Approving 1 of 2...");
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await user.keyboard("{Escape}"); });
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => { finishFirst(); });
    expect(mocks.approve.mock.calls).toEqual([["Ada"], ["Grace"]]);
    expect(within(dialog).getByRole("status").textContent).toBe("Approving 2 of 2...");
    await act(async () => { finishSecond(); });
    await flush();
    expect(within(dialog).getByRole("status").textContent).toBe("2 approved, 0 failed");
    expect(mocks.approve).toHaveBeenCalledTimes(2);
  });

  it("continues after individual failures and reports the name and error", async () => {
    await render([hire("Ada"), hire("Grace"), hire("Linus")]);
    mocks.approve.mockRejectedValueOnce(new Error("Permission denied"));
    const dialog = await open();
    await click(within(dialog).getByRole("button", { name: "Approve 3" }));
    expect(mocks.approve.mock.calls).toEqual([["Ada"], ["Grace"], ["Linus"]]);
    expect(within(dialog).getByRole("status").textContent).toBe("2 approved, 1 failed: Ada: Permission denied");
    await click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("status").textContent).toBe("2 approved, 1 failed: Ada: Permission denied");
  });

  it("cancel does nothing and returns focus to the trigger", async () => {
    await render([hire("Ada"), hire("Grace")]);
    const trigger = screen.getByRole("button", { name: "Approve all (2)" });
    const dialog = await open();
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the list when completed hires remove the trigger", async () => {
    await render([hire("Ada"), hire("Grace")]);
    const dialog = await open();
    mocks.list.mockResolvedValue([]);
    await click(within(dialog).getByRole("button", { name: "Approve 2" }));
    await click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: /^Approve all/ })).toBeNull();
    expect(document.activeElement?.id).toBe("pending-approvals");
    expect(screen.getByRole("status").textContent).toBe("2 approved, 0 failed");
  });

  it("supports keyboard dismissal and focuses the pending list from its review link", async () => {
    await render([hire("Ada"), hire("Grace"), hire("Budget", { type: "budget_override_required" })]);
    await open();
    await act(async () => { await user.keyboard("{Escape}"); });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await open();
    await click(within(dialog).getByRole("link", { name: "View pending list" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement?.id).toBe("pending-approvals");
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("does not allow a snapshot to be confirmed after switching companies", async () => {
    await render([hire("Ada"), hire("Grace")]);
    await open();
    mocks.companyId = "company-2";
    await render([hire("Other A", { companyId: "company-2" }), hire("Other B", { companyId: "company-2" })]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
