// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Storybook already exposes Testing Library DOM queries and user-event.
import { within, userEvent } from "storybook/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@paperclipai/shared";
import { BulkConfirm } from "./BulkConfirm";
import { ThemeProvider } from "../context/ThemeContext";
import { approvalsApi } from "../api/approvals";
import { issuesApi } from "../api/issues";
import { bulkApproval, bulkAttention, bulkOwnerConfirmation, bulkQuestions } from "../fixtures/bulkConfirmFixtures";

let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
const ui = () => within(document.body);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function render(items: AttentionItem[], props: Partial<ComponentProps<typeof BulkConfirm>> = {}) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  await act(async () => root!.render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
      <BulkConfirm companyId="company-1" items={items} agentMap={new Map()} onSelectIndividual={() => {}} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  ));
  await settle();
}
async function click(name: string) {
  await act(async () => userEvent.click(ui().getByRole("button", { name })));
  await settle();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
});

function mockApprovals() {
  const records = [bulkApproval("one"), bulkApproval("two"), bulkApproval("later")];
  const read = vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => records.find((record) => record.id === id)!);
  const write = vi.spyOn(approvalsApi, "approve").mockImplementation(async (id) => ({ ...records.find((record) => record.id === id)!, status: "approved" }));
  return { records, read, write, items: records.map((record) => bulkAttention(record)) };
}

describe("Confirm all", () => {
  it("keeps planning-issue owner confirmations individual", async () => {
    const { items } = mockApprovals();
    const record = { ...bulkOwnerConfirmation(), bulkEligibility: { ownerDecision: true, governed: true, unknownKeys: false } };
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([record]);
    await render([...items.slice(0, 2), bulkAttention(record)]);
    await click("Confirm all (2)");
    expect(ui().getByText("1 item needs your individual answer")).toBeTruthy();
    expect(ui().getByRole("link", { name: bulkAttention(record).subject.title! })).toBeTruthy();
    expect(ui().queryByText("Use a short weekly report? — Answer: Yes, use a short report")).toBeNull();
  });

  it("exposes the full confirmation and question context in accessible collapsed details", async () => {
    const confirmation = bulkOwnerConfirmation();
    confirmation.payload.prompt = "Proceed with the plan below?";
    confirmation.payload.detailsMarkdown = "Use the **weekly** schedule and notify the owner.";
    const question = bulkQuestions();
    question.payload.questions[0].helpText = "Consider the operating cost.";
    question.payload.questions[0].options[0].description = "Low-cost model for short tasks.";
    question.payload.questionSet!.questions[0].options![1].description = "More capacity for long tasks.";
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([confirmation, question]);
    await render([confirmation, question].map((record) => bulkAttention(record)));
    await click("Confirm all (2)");
    const details = [...ui().getByRole("dialog").querySelectorAll("details")];
    expect(details).toHaveLength(2);
    expect(details.every((entry) => !entry.open)).toBe(true);
    for (const entry of details) {
      await act(async () => userEvent.click(entry.querySelector("summary")!));
      expect(entry.open).toBe(true);
    }
    expect(ui().getByText("weekly", { selector: "strong" })).toBeTruthy();
    expect(ui().getByText("Consider the operating cost.")).toBeTruthy();
    expect(ui().getByText("Low-cost model for short tasks.")).toBeTruthy();
    expect(ui().getByText("More capacity for long tasks.")).toBeTruthy();
  });

  it.each([1, 2])("reports %i missing records with singular/plural notices", async (count) => {
    const { items } = mockApprovals();
    const missing = Array.from({ length: count }, (_, index) => bulkOwnerConfirmation(`missing-${index}`));
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([]);
    await render([...items, ...missing.map((record) => bulkAttention(record))]);
    expect(ui().getByText(count === 1 ? "1 item could not be checked. Answer it individually."
      : "2 items could not be checked. Answer them individually.")).toBeTruthy();
    await click("Confirm all (3)");
    expect(ui().getByText(count === 1 ? "1 item needs your individual answer" : "2 items need your individual answer")).toBeTruthy();
  });

  it("keeps audience-restricted interactions individual and rehydrates when the user changes", async () => {
    const { items } = mockApprovals();
    const record = { ...bulkOwnerConfirmation(), addresseeUserId: "owner" };
    vi.spyOn(issuesApi, "listInteractions").mockResolvedValue([record]);
    const allItems = [...items, bulkAttention(record)];
    await render(allItems, { currentUserId: "another-user" });
    await click("Confirm all (3)");
    expect(ui().getByText("1 item needs your individual answer")).toBeTruthy();
    await click("Cancel");
    await render(allItems, { currentUserId: "owner" });
    expect(ui().getByRole("button", { name: "Confirm all (4)" })).toBeTruthy();
  });
  it("names human requesters without exposing their IDs", async () => {
    const { records, items } = mockApprovals();
    records.forEach((record, index) => {
      record.requestedByAgentId = null;
      record.requestedByUserId = ["known-user-uuid", "unknown-user-uuid", "current-user-uuid"][index];
    });
    await render(items, { currentUserId: "current-user-uuid", userLabelMap: new Map([["known-user-uuid", "Sam Rivera"]]) });
    await click("Confirm all (3)");
    const dialog = ui().getByRole("dialog");
    expect(dialog.textContent).toContain("Asked by Sam Rivera");
    expect(dialog.textContent).toContain("Asked by a teammate");
    expect(dialog.textContent).toContain("Asked by You");
    expect(dialog.textContent).not.toContain("user-uuid");
  });

  it("closes the dialog before selecting an individual row without navigating", async () => {
    const { items, write } = mockApprovals();
    const individual = { ...items[0], id: "review", sourceKind: "review" as const };
    const onSelectIndividual = vi.fn(() => expect(ui().queryByRole("dialog")).toBeNull());
    await render([...items, individual], { onSelectIndividual });
    await click("Confirm all (3)");
    const location = window.location.href;
    const link = ui().getByRole("link", { name: individual.subject.title! });
    expect(link.getAttribute("href")).toBe("#attention-row-review");
    await act(async () => userEvent.click(link));
    await settle();
    expect(onSelectIndividual).toHaveBeenCalledWith(individual);
    expect(window.location.href).toBe(location);
    expect(write).not.toHaveBeenCalled();
  });

  it("reuses unchanged reads across invalidation and keeps the button while a changed record loads", async () => {
    const { items, records, read } = mockApprovals();
    await render(items);
    expect(read).toHaveBeenCalledTimes(3);
    await render(structuredClone(items));
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => { await client.invalidateQueries({ queryKey: ["attention", "company-1"] }); });
    expect(read).toHaveBeenCalledTimes(3);
    const button = ui().getByRole("button", { name: "Confirm all (3)" });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    read.mockImplementation(async (id) => { await gate; return records.find((record) => record.id === id)!; });
    await render(items.map((item, index) => index === 0 ? { ...item, updatedAt: "2026-10-12T01:00:00Z" } : item));
    expect(ui().getByRole("button", { name: "Confirm all (3)" })).toBe(button);
    expect(read.mock.calls.map(([id]) => id)).toEqual(["one", "two", "later", "one"]);
    expect((ui().getByRole("button", { name: "Confirm all (3)" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    await settle();
    expect((ui().getByRole("button", { name: "Confirm all (3)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stops after the in-flight write when unmounted and only marks caches stale", async () => {
    const { items, records, write } = mockApprovals();
    await render(items);
    const invalidation = vi.spyOn(client, "invalidateQueries");
    let release: () => void = () => {};
    write.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { ...records[0], status: "approved" };
    });
    await click("Confirm all (3)");
    await click("Confirm 3");
    await act(async () => root?.unmount());
    root = undefined;
    await act(async () => release());
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(invalidation).toHaveBeenCalled();
    expect(invalidation).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["issues", "approvals"], refetchType: "none" }));
    expect(invalidation.mock.calls.every(([options]) => options?.refetchType === "none")).toBe(true);
  });

  it("previews owner answers, cancels without accepting, then accepts the frozen confirmations", async () => {
    const records = [bulkOwnerConfirmation("one"), bulkOwnerConfirmation("two")];
    const read = vi.spyOn(issuesApi, "listInteractions").mockResolvedValue(records);
    const accept = vi.spyOn(issuesApi, "acceptInteraction").mockImplementation(async (_issueId, id) => ({
      ...records.find((record) => record.id === id)!, status: "accepted",
    }));
    await render(records.map((record) => bulkAttention(record)));
    await click("Confirm all (2)");
    expect(ui().getByRole("dialog").textContent).toContain("Use a short weekly report? — Answer: Yes, use a short report");
    await click("Cancel");
    expect(accept).not.toHaveBeenCalled();
    await click("Confirm all (2)");
    const later = bulkOwnerConfirmation("later");
    read.mockResolvedValue([...records, later]);
    await render([...records, later].map((record) => bulkAttention(record)));
    await click("Confirm 2");
    expect(accept.mock.calls).toEqual([["issue-1", "one"], ["issue-1", "two"]]);
    expect(ui().getByRole("status").textContent).toContain("2 confirmed, 0 skipped (changed), 0 failed");
  });

  it.each([0, 1])("hides the button for %i eligible items", async (count) => {
    const { items } = mockApprovals();
    await render(items.slice(0, count));
    expect(ui().queryByRole("button", { name: /Confirm all/ })).toBeNull();
  });

  it("counts only the supplied visible items and cancel performs no writes, restoring focus", async () => {
    const { items, write } = mockApprovals();
    await render(items.slice(0, 2));
    await click("Confirm all (2)");
    expect(ui().getByRole("dialog").textContent).toContain("Approve hire: Specialist one");
    expect(ui().getByRole("dialog").textContent).toContain("Asked by Planner");
    expect(ui().queryByText(/items? needs? your individual answer/)).toBeNull();
    expect(within(ui().getByRole("dialog")).getAllByRole("list")).toHaveLength(1);
    await click("Cancel");
    expect(ui().queryByRole("dialog")).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ui().getByRole("button", { name: "Confirm all (2)" }));
    await render(items.slice(0, 1));
    expect(ui().queryByRole("button", { name: /Confirm all/ })).toBeNull();
  });

  it("freezes the displayed plan and excludes later arrivals from submission", async () => {
    const { items, write } = mockApprovals();
    await render(items.slice(0, 2));
    await click("Confirm all (2)");
    await render(items);
    expect(ui().getByRole("dialog").textContent).not.toContain("Specialist later");
    await click("Confirm 2");
    expect(write.mock.calls.map(([id]) => id)).toEqual(["one", "two"]);
    expect(ui().getByRole("status").textContent).toContain("2 confirmed, 0 skipped (changed), 0 failed");
  });

  it("links individual answers, displays progress and partial results, and invalidates all affected query families", async () => {
    const { items, read, write, records } = mockApprovals();
    const individual = { ...items[0], id: "review", sourceKind: "review" as const, subject: { ...items[0].subject, title: "Review work", href: "/review" } };
    await render([...items, individual]);
    const invalidation = vi.spyOn(client, "invalidateQueries");
    await click("Confirm all (3)");
    expect(ui().getByText("1 item needs your individual answer")).toBeTruthy();
    expect(ui().getByRole("link", { name: "Review work" }).getAttribute("href")).toBe("#attention-row-review");
    read.mockImplementation(async (id) => id === "two" ? { ...records[1], status: "approved" } : records.find((record) => record.id === id)!);
    let release: () => void = () => {};
    write.mockImplementation(async (id) => {
      if (id === "one") await new Promise<void>((resolve) => { release = resolve; });
      if (id === "later") throw new Error("Server unavailable");
      return { ...records[0], status: "approved" };
    });
    await click("Confirm 3");
    expect(ui().getByRole("status").textContent).toContain("Confirming 1 of 3...");
    expect((ui().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    await settle();
    expect(ui().getByRole("status").textContent).toContain("1 confirmed, 1 skipped (changed), 1 failed");
    expect(ui().getByRole("status").textContent).toContain("Server unavailable");
    expect(invalidation.mock.calls.map(([arg]) => arg?.queryKey)).toEqual(expect.arrayContaining([
      ["attention", "company-1"], ["decisions"], ["approvals"], ["issues", "approvals"], ["issues", "interactions"], ["sidebar-badges", "company-1"],
    ]));
  });
});
