// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __liveUpdatesTestUtils } from "../context/LiveUpdatesProvider";
import { Deliverables, deliverablesPollingInterval } from "./Deliverables";
import type { CompanyDeliverable, CompanyDeliverablesResponse } from "@paperclipai/shared";

const mocks = vi.hoisted(() => ({ list: vi.fn(), breadcrumbs: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("../api/deliverables", () => ({ deliverablesApi: { list: mocks.list } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("@/lib/router", async () => {
  const router = await import("react-router-dom");
  return { ...router, Link: ({ disableIssueQuicklook: _, ...props }: React.ComponentProps<typeof router.Link> & { disableIssueQuicklook?: boolean }) => <router.Link {...props} /> };
});
const card = (generationState: CompanyDeliverable["generationState"]): CompanyDeliverable => ({ id: "d", summary: generationState === "generated" ? "The report is ready. Open the file to read it." : null, fallback: "Report. The final comment.", summaryFromTaskDetails: false, nextAttemptAt: null, generationState, issue: { id: "i", identifier: "TOP-1", title: "Report" }, project: null, product: { kind: "document", title: "Report file", target: "reports/a.md", href: null, unavailable: false }, doneBy: { id: "agent", kind: "agent", name: "Writer" }, verifiedBy: null, completedAt: "2026-10-01T00:00:00Z" });
let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); client?.clear(); vi.useRealTimers(); });
async function render(initial = "/deliverables") {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => root!.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}><Deliverables /></MemoryRouter></QueryClientProvider>));
  await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(25); else await new Promise(resolve => setTimeout(resolve, 20)); });
}
describe("Deliverables page", () => {
  it.each([null, { id: "reviewer", kind: "agent" as const, name: "Reviewer" }])("renders the verifier footer correctly: %j", async verifiedBy => {
    mocks.list.mockResolvedValue({ summariesEnabled: true, deliverables: [{ ...card("generated"), verifiedBy }], nextCursor: null });
    await render();
    const footer = container.querySelector('[data-testid="deliverable-card"]')?.lastElementChild;
    expect(footer?.lastElementChild?.textContent).toBe(verifiedBy ? "Verified by Reviewer" : "Not yet verified");
  });
  it.each(["stale", "generating", "retry_scheduled"] as const)("keeps old text visibly out of date during %s", async state => {
    mocks.list.mockResolvedValue({ summariesEnabled: true, deliverables: [{ ...card(state), summary: "The previous summary." }], nextCursor: null });
    await render();
    expect(container.textContent).toContain("The previous summary.");
    expect(container.textContent).toContain("Updating summary…");
  });
  it("checks disabled summaries every five minutes and resumes normal polling when enabled", async () => {
    vi.useFakeTimers(); mocks.list.mockReset();
    mocks.list.mockResolvedValueOnce({ summariesEnabled: false, deliverables: [card("pending")], nextCursor: null })
      .mockResolvedValueOnce({ summariesEnabled: true, deliverables: [card("pending")], nextCursor: null })
      .mockResolvedValue({ summariesEnabled: true, deliverables: [card("generated")], nextCursor: null });
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(299000); });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Report. The final comment.");
    expect(deliverablesPollingInterval({ pages: [
      { summariesEnabled: true, deliverables: [card("pending")], nextCursor: "more" },
      { summariesEnabled: false, deliverables: [card("pending")], nextCursor: null },
    ] })).toBe(300000);
    await act(async () => { await vi.advanceTimersByTimeAsync(1025); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30025); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });
  it("polls scheduled retries every 30 seconds even during a two-hour backoff", () => {
    vi.useFakeTimers();
    expect(deliverablesPollingInterval({ pages: [{ summariesEnabled: true, deliverables: [
      { ...card("retry_scheduled"), nextAttemptAt: new Date(Date.now() + 7200000).toISOString() },
    ], nextCursor: null }] })).toBe(30000);
  });
  it.each(["from=2026-10-01", "to=2026-10-12"])("labels custom dates and filtered empty results: %s", async params => {
    mocks.list.mockResolvedValue({ summariesEnabled: true, deliverables: [], nextCursor: null });
    await render(`/deliverables?${params}`);
    expect(container.textContent).toContain("No finished work matches these filters.");
    expect(container.querySelector('[data-testid="deliverable-range-filter"]')?.textContent).toBe("Custom");
  });
  it.each(["pending", "generated"] as const)("labels task details only with stored text: %s", async (state) => {
    mocks.list.mockResolvedValue({ summariesEnabled: true, deliverables: [{ ...card(state), summaryFromTaskDetails: true }], nextCursor: null });
    await render();
    expect(container.textContent!.includes("Summary from task details")).toBe(state === "generated");
  });
  it("renders fallback, author, result path and filters", async () => {
    mocks.list.mockResolvedValue({ summariesEnabled: true, deliverables: [card("pending")], nextCursor: null });
    await render("/deliverables?project=project&from=2026-10-01&to=2026-10-12");
    expect(container.textContent).toContain("Report. The final comment.");
    expect(container.textContent).toContain("Done by Writer"); expect(container.textContent).toContain("reports/a.md");
    expect(mocks.list).toHaveBeenCalledWith("company", expect.objectContaining({ projectId: "project", from: "2026-10-01T00:00:00.000Z", to: "2026-10-13T00:00:00.000Z" }));
    expect(container.querySelector('input[aria-label="Completed through"]')).toBeTruthy();
  });
  it.each([["pending", "generating", "generated"], ["retry_scheduled", "generating", "generated"], ["stale", "retry_scheduled", "generated"]] as const)("keeps polling through %s → %s → %s", async (...states) => {
    for (const state of states) expect(deliverablesPollingInterval({ pages: [{ summariesEnabled: true, deliverables: [card(state)], nextCursor: null }] })).toBe(state === "generated" ? false : 30000);
    expect(deliverablesPollingInterval({ pages: [{ summariesEnabled: true, deliverables: [card("failed_final")], nextCursor: null }] })).toBe(false);
    expect(deliverablesPollingInterval({ pages: [{ summariesEnabled: true, deliverables: [card("generated")], nextCursor: null }, { summariesEnabled: true, deliverables: [card("stale")], nextCursor: null }] })).toBe(30000);
  });
  it("invalidates deliverables on live issue/comment events so stale cards resume polling", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    for (const action of ["issue.updated", "issue.comment_added"]) {
      __liveUpdatesTestUtils.invalidateActivityQueries(queryClient, "company", { entityType: "issue", entityId: "i", action }, { userId: null, agentId: null });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deliverables", "company"] });
      invalidate.mockClear();
    }
    queryClient.clear();
  });
  it.each(["pending", "retry_scheduled"] as const)("refetches every 30 seconds from %s until the stored summary is ready", async initialState => {
    vi.useFakeTimers(); mocks.list.mockReset();
    mocks.list.mockResolvedValueOnce({ summariesEnabled: true, deliverables: [{ ...card(initialState), nextAttemptAt: new Date(Date.now() + 7200000).toISOString() }], nextCursor: null })
      .mockResolvedValueOnce({ summariesEnabled: true, deliverables: [card("generating")], nextCursor: null })
      .mockResolvedValue({ summariesEnabled: true, deliverables: [card("generated")], nextCursor: null });
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(30025); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30025); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("The report is ready.");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });
  it("loads another page and surfaces errors", async () => {
    mocks.list.mockResolvedValueOnce({ summariesEnabled: true, deliverables: [card("generated")], nextCursor: "next" } satisfies CompanyDeliverablesResponse)
      .mockRejectedValue(new Error("Could not load the next page"));
    await render();
    await act(async () => (container.querySelector('[data-testid="deliverables-load-more"]') as HTMLButtonElement).click());
    await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(25); else await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain("Could not load the next page");
  });
});
