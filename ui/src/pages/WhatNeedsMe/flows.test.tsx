// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within, fireEvent, userEvent } from "storybook/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bulkApproval, bulkAttention, bulkOwnerConfirmation, bulkQuestions } from "../../fixtures/bulkConfirmFixtures";
import { approvalsApi } from "../../api/approvals";
import { issuesApi } from "../../api/issues";
import { decisionsApi } from "../../api/decisions";
import { HiringList, ConfirmationRow } from "./CompactDecisions";
import { QuestionQueue } from "./QuestionQueue";
import { validateDecisionRecord, type HydratedDecision } from "./classifyDecision";

import { plainDecision } from "./testFixtures";

vi.mock("../../components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));

let root: Root, container: HTMLDivElement, client: QueryClient;
const ui = () => within(container);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function render(node: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)); }
async function click(name: string | RegExp) { await act(async () => userEvent.click(ui().getByRole("button", { name }))); }
async function key(value: string) { await act(async () => { fireEvent.keyDown(document.activeElement ?? window, { key: value }); }); }
const hydrate = (record: ReturnType<typeof bulkQuestions>) => validateDecisionRecord(bulkAttention(record), record)!;
const queue = (entries: HydratedDecision[]) => <QuestionQueue companyId="company-1" entries={entries} agentMap={new Map()} />;
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });
it("approves and cancels hires using existing APIs and refreshes G's query families", async () => {
  const a = bulkApproval("a"), b = bulkApproval("b");
  const approve = vi.spyOn(approvalsApi, "approve").mockResolvedValue({ ...a, status: "approved" });
  const reject = vi.spyOn(approvalsApi, "reject").mockResolvedValue({ ...b, status: "rejected" });
  vi.spyOn(approvalsApi, "get").mockImplementation(async (id) => id === "a" ? a : b);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await render(<HiringList companyId="company-1" entries={[a, b].map((record) => ({ item: bulkAttention(record), record }))} agentMap={new Map()} />);
  await act(async () => userEvent.click(ui().getAllByRole("button", { name: "Approve" })[0]));
  expect(approve).toHaveBeenCalledWith("a");
  await click("Cancel");
  expect(reject).toHaveBeenCalledWith("b", "Cancelled by the owner.");
  for (const prefix of ["attention", "decisions", "approvals", "issues", "agents", "sidebar-badges", "decision-queues", "bulk-confirm-records"]) {
    expect(invalidate.mock.calls.some(([options]) => options?.queryKey?.[0] === prefix)).toBe(true);
  }
});
it("offers Yes and No, and requires a nonblank reason when requested", async () => {
  const record = bulkOwnerConfirmation();
  const accept = vi.spyOn(issuesApi, "acceptInteraction").mockResolvedValue({ ...record, status: "accepted" });
  const reject = vi.spyOn(issuesApi, "rejectInteraction").mockResolvedValue({ ...record, status: "rejected" });
  await render(<ConfirmationRow companyId="company-1" record={record} />);
  await click("Yes"); expect(accept).toHaveBeenCalledWith(record.issueId, record.id);
  await render(<ConfirmationRow key="reason" companyId="company-1" record={{ ...record, payload: { ...record.payload, rejectRequiresReason: true } }} />);
  await click("No");
  expect(reject).not.toHaveBeenCalled();
  expect((ui().getByRole("button", { name: "Submit reason" }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(ui().getByRole("textbox"));
  await act(async () => userEvent.type(ui().getByRole("textbox"), "Too soon")); await click("Submit reason");
  expect(reject).toHaveBeenCalledWith(record.issueId, record.id, "Too soon");
  await render(<ConfirmationRow key="plain" companyId="company-1" record={record} />); await click("No");
  expect(reject).toHaveBeenLastCalledWith(record.issueId, record.id, undefined);
});
it("answers immediately, advances, keeps focus and announces All caught up", async () => {
  const a = bulkQuestions("a"), b = bulkQuestions("b"); b.payload.questions[0].prompt = "Next choice?";
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockImplementation(async (_issue, id) => ({ ...(id === "a" ? a : b), status: "answered" }));
  await render(queue([hydrate(a), hydrate(b)]));
  expect(ui().getByText("1 of 2")).toBeTruthy();
  expect(ui().getAllByRole("button")[0].textContent).toContain("Recommended");
  await click(/Gemini Flash-Lite/);
  expect(send).toHaveBeenCalledWith("issue-1", "a", { answers: [{ questionId: "model", optionIds: ["a"] }] });
  expect(ui().getByRole("heading").textContent).toBe("Next choice?");
  expect(ui().getByText("1 of 1")).toBeTruthy();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Next choice?");
  expect(document.activeElement?.getAttribute("aria-live")).toBe("polite");
  await key("2"); expect(ui().getByRole("heading").textContent).toBe("All caught up");
});
it("Skip and Back preserve unanswered interactions; shortcuts browse without sending", async () => {
  const a = bulkQuestions("a"), b = bulkQuestions("b"); b.payload.questions[0].prompt = "Second?";
  const send = vi.spyOn(issuesApi, "respondToInteraction");
  await render(queue([hydrate(a), hydrate(b)]));
  await key("s"); expect(ui().getByRole("heading").textContent).toBe("Second?");
  await key("ArrowLeft"); expect(ui().getByText("1 of 2")).toBeTruthy();
  await key("ArrowRight"); expect(ui().getByText("2 of 2")).toBeTruthy();
  await click("Skip"); expect(ui().getByRole("heading").textContent).toBe("2 unanswered requests");
  expect(ui().getByText("You skipped these requests. Go back to answer them.")).toBeTruthy();
  expect(ui().queryByText("All caught up")).toBeNull();
  await click("Back"); expect(ui().getByRole("heading").textContent).toBe("Second?");
  expect(send).not.toHaveBeenCalled();
});
it("keeps the current card, restores keyboard focus after a submission error, then retries", async () => {
  const a = bulkQuestions();
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({ ...a, status: "answered" });
  await render(queue([hydrate(a)])); await click(/Gemini Flash-Lite/);
  expect(ui().getByRole("alert").textContent).toBe("Offline");
  expect(ui().getByRole("heading").textContent).toBe(a.payload.questions[0].prompt);
  expect(document.activeElement).toBe(ui().getByLabelText(a.payload.questions[0].prompt));
  await key("1"); expect(send).toHaveBeenCalledTimes(2);
  expect(ui().getByRole("heading").textContent).toBe("All caught up");
});
it("keeps a multi-question draft, navigates Back, and sends only on the final question", async () => {
  const a = bulkQuestions(); delete a.payload.questionSet;
  a.payload.questions.push({ ...a.payload.questions[0], id: "second", prompt: "Second question?" });
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...a, status: "answered" });
  await render(queue([hydrate(a)])); await click(/Gemini Flash-Lite/);
  expect(send).not.toHaveBeenCalled(); expect(ui().getByRole("heading").textContent).toBe("Second question?");
  await click("Back"); await click(/Another model/); await click(/Gemini Flash-Lite/);
  expect(send).toHaveBeenCalledWith("issue-1", a.id, { answers: [
    { questionId: "model", optionIds: ["b"] }, { questionId: "second", optionIds: ["a"] },
  ] });
});
it("custom text clicked or numbered opens a focused input without sending", async () => {
  const a = bulkQuestions(); delete a.payload.questionSet;
  a.payload.questions[0].options.push({ id: "custom", label: "Describe it", freeText: true });
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...a, status: "answered" });
  await render(queue([hydrate(a)])); await key("3");
  expect(send).not.toHaveBeenCalled(); expect(document.activeElement).toBe(ui().getByRole("textbox"));
  await act(async () => userEvent.type(ui().getByRole("textbox"), "My model{Enter}"));
  expect(send).toHaveBeenCalledWith("issue-1", a.id, { answers: [{ questionId: "model", optionIds: [], otherText: "My model" }] });
});
it("supports multi-select Done and text-only Submit", async () => {
  const a = bulkQuestions(); delete a.payload.questionSet; a.payload.questions[0].selectionMode = "multi";
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...a, status: "answered" });
  await render(queue([hydrate(a)]));
  await act(async () => userEvent.click(ui().getAllByRole("checkbox")[0]));
  expect(send).not.toHaveBeenCalled(); await click("Done");
  expect(send.mock.calls[0][2].answers[0].optionIds).toEqual(["a"]);
  const b = bulkQuestions("text"); b.payload.questionSet!.questions[0].answerMode = "text"; delete b.payload.questionSet!.questions[0].options;
  await render(<QuestionQueue key="text" companyId="company-1" entries={[hydrate(b)]} agentMap={new Map()} />);
  await act(async () => userEvent.type(ui().getByRole("textbox"), "A text answer")); await click("Submit");
  expect(send.mock.calls[1][2].answers[0].otherText).toBe("A text answer");
});
it("uses wrapping, shrinkable layout at phone width", async () => {
  vi.stubGlobal("innerWidth", 390);
  await render(queue([hydrate(bulkQuestions())]));
  expect(container.firstElementChild?.className).toContain("min-w-0");
  const option = ui().getByRole("button", { name: /Gemini Flash-Lite/ });
  expect(option.className).toContain("whitespace-normal");
  expect(option.className).toContain("h-auto");
  vi.unstubAllGlobals();
});
it("submits a standalone plain choice through the decisions API", async () => {
  const item = bulkAttention(bulkApproval("plain"), "decision"); item.subject.kind = "decision";
  const record = { ...plainDecision(), id: "plain" };
  const decide = vi.spyOn(decisionsApi, "decide").mockResolvedValue({ ...record, status: "decided" });
  await render(queue([{ item, kind: "decision", record }]));
  await click(/Blue/);
  expect(decide).toHaveBeenCalledWith("plain", { optionId: "blue" });
  expect(ui().getByRole("heading").textContent).toBe("All caught up");
});
it("places the recommended option first even when it arrived last", async () => {
  const record = bulkQuestions(); record.payload.questions[0].options.reverse();
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...record, status: "answered" });
  await render(queue([hydrate(record)]));
  expect(ui().getAllByRole("button")[0].textContent).toContain("Gemini Flash-Lite");
  await key("1");
  expect(send.mock.calls[0][2].answers[0].optionIds).toEqual(["a"]);
});
it("clicking an explicit free-text choice does not send and normal choices can replace it", async () => {
  const record = bulkQuestions(); delete record.payload.questionSet;
  record.payload.questions[0].options.push({ id: "custom", label: "Describe it", freeText: true });
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...record, status: "answered" });
  await render(queue([hydrate(record)])); await click(/Describe it/);
  expect(send).not.toHaveBeenCalled(); expect(document.activeElement).toBe(ui().getByRole("textbox"));
  await click(/Another model/);
  expect(send.mock.calls[0][2].answers[0]).toEqual({ questionId: "model", optionIds: ["b"] });
});
it("skips the whole multi-question interaction and restores its draft with Back", async () => {
  const a = bulkQuestions("a"), b = bulkQuestions("b"); delete a.payload.questionSet;
  a.payload.questions.push({ ...a.payload.questions[0], id: "second", prompt: "Second draft question?" });
  b.payload.questions[0].prompt = "Another interaction?";
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...a, status: "answered" });
  await render(queue([hydrate(a), hydrate(b)])); await click(/Another model/); await click("Skip");
  expect(ui().getByRole("heading").textContent).toBe("Another interaction?");
  expect(send).not.toHaveBeenCalled();
  await click("Back"); await key("ArrowRight"); await click(/Gemini Flash-Lite/);
  expect(send).toHaveBeenCalledWith("issue-1", "a", { answers: [
    { questionId: "model", optionIds: ["b"] }, { questionId: "second", optionIds: ["a"] },
  ] });
});

it("keeps skipped work visible after other interactions are answered, and counts only unanswered requests", async () => {
  const a = bulkQuestions("a"), b = bulkQuestions("b");
  b.payload.questions[0].prompt = "Second?";
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockImplementation(async (_issue, id) => ({ ...(id === "a" ? a : b), status: "answered" }));
  await render(queue([hydrate(a), hydrate(b)]));
  await click("Skip"); await click(/Gemini Flash-Lite/);
  expect(ui().getByRole("heading").textContent).toBe("1 unanswered request");
  expect(ui().queryByText("All caught up")).toBeNull();
  await click("Back");
  expect(ui().getByText("1 of 1")).toBeTruthy();
  expect(ui().getByRole("heading").textContent).toBe(a.payload.questions[0].prompt);
  await key("1");
  expect(send).toHaveBeenCalledTimes(2);
  expect(ui().getByRole("heading").textContent).toBe("All caught up");
});
it("keeps number, skip and arrow shortcuts working with a focused checkbox", async () => {
  const a = bulkQuestions("a"), b = bulkQuestions("b"); delete a.payload.questionSet;
  a.payload.questions[0].selectionMode = "multi";
  delete b.payload.questionSet; b.payload.questions[0].selectionMode = "multi";
  b.payload.questions[0].prompt = "Second?";
  const send = vi.spyOn(issuesApi, "respondToInteraction");
  await render(queue([hydrate(a), hydrate(b)]));
  await act(async () => userEvent.click(ui().getAllByRole("checkbox")[0]));
  expect(document.activeElement).toBe(ui().getAllByRole("checkbox")[0]);
  await key("2");
  expect((ui().getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);
  await key("ArrowRight"); expect(ui().getByRole("heading").textContent).toBe("Second?");
  await act(async () => userEvent.click(ui().getAllByRole("checkbox")[0]));
  await key("ArrowLeft");
  await act(async () => userEvent.click(ui().getAllByRole("checkbox")[0]));
  await key("s"); expect(ui().getByRole("heading").textContent).toBe("Second?");
  await key("ArrowLeft");
  await act(async () => userEvent.click(ui().getAllByRole("checkbox")[0]));
  await key("ArrowLeft"); // No previous request; the checkbox and draft remain usable.
  expect(ui().getByRole("heading").textContent).toBe(a.payload.questions[0].prompt);
  expect(send).not.toHaveBeenCalled();
});
it.each(["prompt", "label"])("does not recommend or reorder a choice when canonical %s differs", async (mismatch) => {
  const record = bulkQuestions(); record.payload.questions[0].options.reverse();
  const shown = record.payload.questionSet!.questions[0];
  if (mismatch === "prompt") shown.prompt = "A different question?";
  else shown.options![0].label = "A different model";
  const send = vi.spyOn(issuesApi, "respondToInteraction").mockResolvedValue({ ...record, status: "answered" });
  await render(queue([hydrate(record)]));
  expect(ui().queryByText("Recommended")).toBeNull();
  expect(ui().getAllByRole("button")[0].textContent).toContain("Another model");
  await key("1");
  expect(send.mock.calls[0][2].answers[0].optionIds).toEqual(["b"]);
});
