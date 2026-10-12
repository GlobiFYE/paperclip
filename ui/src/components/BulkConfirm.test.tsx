// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Storybook already exposes Testing Library DOM queries and user-event.
import { within, userEvent } from "storybook/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@paperclipai/shared";
import { BulkConfirm } from "./BulkConfirm";
import { approvalsApi } from "../api/approvals";
import { bulkApproval, bulkAttention } from "../fixtures/bulkConfirmFixtures";

let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;
const ui = () => within(document.body);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function render(items: AttentionItem[]) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  await act(async () => root!.render(
    <QueryClientProvider client={client}>
      <BulkConfirm companyId="company-1" items={items} revision="v1" agentMap={new Map()} />
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
    expect(ui().getByText("1 items need your individual answer")).toBeTruthy();
    expect(ui().getByRole("link", { name: "Review work" }).getAttribute("href")).toBe("/review");
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
      ["attention", "company-1"], ["decisions"], ["approvals"], ["issues", "interactions"], ["sidebar-badges", "company-1"],
    ]));
  });
});
