// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { within, userEvent } from "storybook/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { Hiring, usePendingHireCount } from "./Hiring";
import { SidebarNavItem } from "../components/SidebarNavItem";
import { UserPlus } from "lucide-react";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { bulkApproval } from "../fixtures/bulkConfirmFixtures";
import { applyCompanyPrefix, isBoardPathWithoutPrefix } from "../lib/company-routes";
import { readFileSync } from "node:fs";
const context = vi.hoisted(() => ({ setBreadcrumbs: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "ACME" } }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => context }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ collapsed: false, peeking: false, isMobile: true, setSidebarOpen: vi.fn() }) }));
vi.mock("../hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
function BadgeProbe() { const count = usePendingHireCount("company-1"); return <SidebarNavItem to="/hiring" label="Hiring" icon={UserPlus} badge={count} badgeLabel="hires waiting" />; }
let root: Root, container: HTMLDivElement, client: QueryClient;
const ui = () => within(document.body);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/ACME/hiring"]}><Hiring /><BadgeProbe /></MemoryRouter></QueryClientProvider>)); await settle(); await settle(); }
const a = bulkApproval("hire-a"), b = bulkApproval("hire-b");
function agent(id: string, age: number, status = "idle"): Agent { return { id, name: id, urlKey: id, companyId: "company-1", status,
  title: "Engineer", adapterConfig: { model: "Model A" }, metadata: { division: "Engineering" }, reportsTo: null,
  createdAt: new Date(Date.now() - age * 86_400_000) } as unknown as Agent; }
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(approvalsApi, "list").mockResolvedValue([a, b]);
  vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => id === a.id ? a : b);
  vi.spyOn(agentsApi, "list").mockResolvedValue([agent("Recent", 2), agent("Month", 15, "running"), agent("Older", 60, "paused"), agent("Pending", 2, "pending_approval"), agent("Terminated", 2, "terminated")]);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });
it("renders both sections, sidebar badge, company links, and 7/30/90 day filters", async () => {
  await mount();
  expect(ui().getByRole("heading", { name: /Waiting for you/ })).toBeTruthy();
  expect(ui().getByRole("heading", { name: "Recently hired" })).toBeTruthy();
  expect(ui().getByRole("link", { name: /Hiring/ }).getAttribute("href")).toBe("/ACME/hiring");
  expect(ui().getByRole("link", { name: /Hiring/ }).textContent).toContain("2");
  expect(ui().getByRole("link", { name: /Recent ·/ }).getAttribute("href")).toBe("/ACME/agents/Recent");
  expect(ui().getByRole("link", { name: /Month ·/ })).toBeTruthy();
  expect(ui().queryByRole("link", { name: /Older|Pending|Terminated/ })).toBeNull();
  await act(async () => userEvent.click(ui().getByRole("button", { name: "7 days" })));
  expect(ui().queryByRole("link", { name: /Month ·/ })).toBeNull();
  await act(async () => userEvent.click(ui().getByRole("button", { name: "90 days" })));
  expect(ui().getByRole("link", { name: /Older ·/ })).toBeTruthy();
  expect(ui().getByRole("group", { name: "Time range" }).className).toContain("flex-wrap");
});
it("uses the shared snapshot dialog before approving all and updates the badge", async () => {
  const approve = vi.spyOn(approvalsApi, "approve").mockImplementation(async (id) => {
    vi.mocked(approvalsApi.list).mockResolvedValue(id === b.id ? [] : [b]);
    return { ...(id === a.id ? a : b), status: "approved" };
  });
  await mount();
  await act(async () => userEvent.click(ui().getByRole("button", { name: "Approve all (2)" })));
  expect(approve).not.toHaveBeenCalled();
  expect(ui().getByRole("dialog").textContent).toContain("New arrivals are not included");
  await act(async () => userEvent.click(ui().getByRole("button", { name: "Confirm 2" })));
  await settle();
  expect(approve).toHaveBeenCalledTimes(2);
  expect(ui().getByRole("dialog").textContent).toContain("2 confirmed");
  await act(async () => userEvent.click(ui().getAllByRole("button", { name: "Close" })[0]));
  expect(ui().getByRole("link", { name: /Hiring/ }).textContent).not.toContain("2");
});
it("excludes rejected hire approvals even if an agent has an eligible status", async () => {
  vi.mocked(approvalsApi.list).mockResolvedValue([{ ...a, status: "rejected", payload: { agentId: "Recent" } }]);
  await mount(); expect(ui().queryByRole("link", { name: /Recent ·/ })).toBeNull();
});
it("keeps company-prefixed hiring and unprefixed redirects registered", () => {
  expect(isBoardPathWithoutPrefix("/hiring")).toBe(true);
  expect(applyCompanyPrefix("/hiring", "ACME")).toBe("/ACME/hiring");
  const app = readFileSync(`${process.cwd()}/src/App.tsx`, "utf8");
  expect(app).toContain('<Route path="hiring" element={<Hiring />} />');
  expect(app).toContain('<Route path="hiring" element={<UnprefixedBoardRedirect />} />');
  for (const file of ["Sidebar.tsx", "Sidebar.production.tsx"]) {
    expect(readFileSync(`${process.cwd()}/src/components/${file}`, "utf8")).toContain('badge={pendingHireCount}');
  }
});
