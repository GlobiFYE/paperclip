// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Issue, IssueDocument } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { useIssuePlanDocument } from "./useIssuePlanDocument";

vi.mock("@/api/issues", () => ({ issuesApi: { getDocument: vi.fn() } }));
const issue = {
  id: "task-id", identifier: "TASK-1", companyId: "company-id", title: "Saved task",
  status: "todo", workMode: "standard", priority: "medium", projectId: null,
  parentId: null, description: null, assigneeAgentId: null, assigneeUserId: null,
  executionRunId: null, issueNumber: 1, requestDepth: 0, createdAt: new Date(), updatedAt: new Date(),
} as Issue;
const plan = { id: "plan-id", issueId: issue.id, key: "plan", body: "Saved plan", latestRevisionId: "revision-1" } as IssueDocument;
let client: QueryClient;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function View({ issueId = issue.id }: { issueId?: string }) {
  const result = useIssuePlanDocument(issueId);
  return <div data-loading={result.isLoading} data-error={result.isError}>{result.data?.body ?? "No plan"}</div>;
}
async function mount(issueId = issue.id) {
  await act(async () => root.render(<QueryClientProvider client={client}><View issueId={issueId} /></QueryClientProvider>));
}
function cache(value: IssueDocument | null | undefined, updatedAt = Date.now()) {
  client.setQueryData(queryKeys.issues.detail(issue.id), { ...issue, planDocument: value }, { updatedAt });
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  vi.mocked(issuesApi.getDocument).mockReset().mockResolvedValue(plan);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
it.each([null, plan])("uses an authoritative cached plan value without another loading round trip: %s", async (value) => {
  cache(value);
  await mount();
  expect(host.firstElementChild?.getAttribute("data-loading")).toBe("false");
  expect(host.textContent).toBe(value?.body ?? "No plan");
  expect(issuesApi.getDocument).not.toHaveBeenCalled();
});
it("revalidates document events after seeding an absent plan, including deletion", async () => {
  cache(null);
  await mount();
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) }); });
  expect(issuesApi.getDocument).toHaveBeenCalledExactlyOnceWith(issue.id, "plan");
  expect(client.getQueryData([...queryKeys.issues.documents(issue.id), "plan"])).toEqual(plan);
  vi.mocked(issuesApi.getDocument).mockRejectedValue(new ApiError("Not found", 404, null));
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.issues.documents(issue.id) }); });
  expect(client.getQueryData([...queryKeys.issues.documents(issue.id), "plan"])).toBeNull();
  expect(host.firstElementChild?.getAttribute("data-error")).toBe("false");
});
it.each(["stale", "invalidated", "missing-field"])("keeps the initial reveal waiting when detail is %s", async (state) => {
  cache(state === "missing-field" ? undefined : null, state === "stale" ? Date.now() - 60_000 : Date.now());
  if (state === "invalidated") await client.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.id) });
  vi.mocked(issuesApi.getDocument).mockReturnValue(new Promise(() => {}));
  await mount();
  expect(issuesApi.getDocument).toHaveBeenCalledExactlyOnceWith(issue.id, "plan");
  expect(host.firstElementChild?.getAttribute("data-loading")).toBe("true");
});
it("does not seed another task's plan or fetch draft conversations", async () => {
  cache(plan);
  await mount("different-task");
  expect(issuesApi.getDocument).toHaveBeenCalledExactlyOnceWith("different-task", "plan");
  vi.mocked(issuesApi.getDocument).mockClear();
  await mount("chat:draft");
  expect(issuesApi.getDocument).not.toHaveBeenCalled();
});
