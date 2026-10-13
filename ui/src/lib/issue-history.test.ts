// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useIssueHistory, type UseIssueHistoryOptions } from "@/hooks/useIssueHistory";
import { ISSUE_HISTORY_PAGE_SIZE } from "./issue-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Item = { id: string; createdAt: string; value: string };
type HookProps = Pick<UseIssueHistoryOptions<Item>, "queryKey" | "fetchPage">;
type HarnessResult = ReturnType<typeof useIssueHistory<Item>>;

const mounted: Array<() => void> = [];

function renderHook(props: HookProps, client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
})) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let currentProps = props;
  const result = {} as { current: HarnessResult };
  function Harness() {
    result.current = useIssueHistory<Item>({
      ...currentProps,
      getId: (item) => item.id,
      getCreatedAt: (item) => item.createdAt,
    });
    return null;
  }
  function render() {
    act(() => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  }
  function rerender(next: HookProps) {
    currentProps = next;
    render();
  }
  function unmount() {
    act(() => root.unmount());
    host.remove();
    client.clear();
  }
  render();
  mounted.push(unmount);
  return { result, rerender, unmount, client };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for query state");
}

function makeItems(start: number, count: number): Item[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      id: `item-${String(9999 - index).padStart(4, "0")}`,
      createdAt: new Date(1_800_000_000_000 - Math.floor(index / 2) * 1_000).toISOString(),
      value: `value-${index}`,
    };
  });
}

function pageFrom(dataset: readonly Item[], before?: string) {
  const start = before
    ? dataset.findIndex((item) => item.id === before) + 1
    : 0;
  if (start <= 0 && before) return [];
  return dataset.slice(start, start + ISSUE_HISTORY_PAGE_SIZE);
}

function pagedFetcher(dataset: readonly Item[], calls: Array<string | undefined>) {
  return async (before?: string) => {
    calls.push(before);
    return pageFrom(dataset, before);
  };
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

it("loads a bounded head and continues through a 123-item dataset with stable ties and no duplicates", async () => {
  const dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  const fetchPage = pagedFetcher(dataset, calls);
  const { result } = renderHook({ queryKey: ["history", "task-a"], fetchPage });

  await act(async () => waitUntil(() => result.current.data?.length === 50));
  expect(calls).toEqual([undefined]);
  expect(result.current.data).toHaveLength(50);
  expect(result.current.hasMore).toBe(true);

  await act(async () => result.current.loadOlder());
  expect(result.current.data).toHaveLength(100);
  expect(result.current.data?.map((item) => item.id)).toEqual(dataset.slice(0, 100).map((item) => item.id));

  await act(async () => result.current.loadOlder());
  expect(result.current.data).toHaveLength(123);
  expect(result.current.data?.map((item) => item.id)).toEqual(dataset.map((item) => item.id));
  expect(new Set(result.current.data?.map((item) => item.id)).size).toBe(123);
  expect(result.current.hasMore).toBe(false);
  expect(calls).toHaveLength(3);
});

it("refetches only the head and preserves previously loaded snapshots", async () => {
  const dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  const fetchPage = pagedFetcher(dataset, calls);
  const { result, client } = renderHook({ queryKey: ["history", "task-b"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  await act(async () => result.current.loadOlder());
  const priorCalls = [...calls];

  await act(async () => {
    await client.invalidateQueries({ queryKey: ["history", "task-b"] });
  });

  expect(calls).toEqual([...priorCalls, undefined]);
  expect(result.current.data).toHaveLength(100);
  expect(result.current.data?.map((item) => item.id)).toEqual(dataset.slice(0, 100).map((item) => item.id));
});

it("does not retain head snapshots until older history is requested and stops at a short end page", async () => {
  let dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  const fetchPage = async (before?: string) => {
    calls.push(before);
    return pageFrom(dataset, before);
  };
  const { result, client } = renderHook({ queryKey: ["history", "task-head-only"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));

  for (let shift = 0; shift < 3; shift += 1) {
    const newHead = makeItems(-50 * (shift + 1), 50).map((item, index) => ({
      ...item,
      id: `head-${shift}-${String(index).padStart(4, "0")}`,
      createdAt: new Date(2_000_000_000_000 + shift * 100_000 + (50 - index) * 1_000).toISOString(),
    }));
    dataset = [...newHead, ...dataset];
    const previousCalls = calls.length;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["history", "task-head-only"] });
      await waitUntil(() => calls.length > previousCalls && result.current.data?.[0]?.id === newHead[0]?.id);
    });
    expect(result.current.data).toHaveLength(50);
  }

  const shortDataset = makeItems(500, 63);
  const shortCalls: Array<string | undefined> = [];
  const shortFetcher = pagedFetcher(shortDataset, shortCalls);
  const shortHistory = renderHook({ queryKey: ["history", "short-end"], fetchPage: shortFetcher });
  await act(async () => waitUntil(() => shortHistory.result.current.data?.length === 50));
  await act(async () => shortHistory.result.current.loadOlder());
  expect(shortHistory.result.current.data).toHaveLength(63);
  expect(shortHistory.result.current.hasMore).toBe(false);
  await act(async () => shortHistory.result.current.loadOlder());
  expect(shortCalls).toHaveLength(2);
});

it("preserves the exhausted cursor when a refreshed head has the same IDs", async () => {
  const dataset = makeItems(0, 63);
  const calls: Array<string | undefined> = [];
  let revision = 0;
  const fetchPage = async (before?: string) => {
    calls.push(before);
    return pageFrom(dataset, before).map((item) => ({ ...item, value: `${item.value}-r${revision}` }));
  };
  const { result, client } = renderHook({ queryKey: ["history", "same-boundary"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  await act(async () => result.current.loadOlder());
  expect(result.current.hasMore).toBe(false);
  revision += 1;

  await act(async () => {
    await client.invalidateQueries({ queryKey: ["history", "same-boundary"] });
    await waitUntil(() => calls.length === 3);
  });
  expect(result.current.hasMore).toBe(false);
  await act(async () => waitUntil(() => result.current.data?.[0]?.value.endsWith("-r1") ?? false));
  const callsAfterRefresh = calls.length;
  await act(async () => result.current.loadOlder());
  expect(calls).toHaveLength(callsAfterRefresh);
});

it("keeps the loaded cursor for a five-item overlapping head shift", async () => {
  let dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  const fetchPage = async (before?: string) => {
    calls.push(before);
    return pageFrom(dataset, before);
  };
  const { result, client } = renderHook({ queryKey: ["history", "overlap"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  await act(async () => result.current.loadOlder());
  const afterLoadedHundred = dataset[99]!.id;
  const added = makeItems(-5, 5).map((item, index) => ({
    ...item,
    id: `added-${index}`,
    createdAt: new Date(1_900_000_000_000 + (5 - index) * 1_000).toISOString(),
  }));
  dataset = [...added, ...dataset];
  const previousCalls = calls.length;

  await act(async () => {
    await client.invalidateQueries({ queryKey: ["history", "overlap"] });
    await waitUntil(() => calls.length > previousCalls && result.current.data?.[0]?.id === added[0]?.id);
  });
  expect(result.current.data).toHaveLength(105);
  await act(async () => result.current.loadOlder());
  expect(calls[calls.length - 1]).toBe(afterLoadedHundred);
  expect(calls[calls.length - 1]).not.toBe(result.current.data?.[49]?.id);
  expect(result.current.data).toHaveLength(128);
});

it("keeps loaded history and makes a gap larger than one page loadable after a head burst", async () => {
  let dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  const fetchPage = async (before?: string) => {
    calls.push(before);
    return pageFrom(dataset, before);
  };
  const { result, client } = renderHook({ queryKey: ["history", "task-c"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  await act(async () => result.current.loadOlder());
  const previouslyLoaded = dataset.slice(0, 100).map((item) => item.id);

  const burst = makeItems(-117, 117).map((item, index) => ({
    ...item,
    id: `burst-${String(9999 - index).padStart(4, "0")}`,
    createdAt: new Date(1_900_000_000_000 - Math.floor(index / 2) * 1_000).toISOString(),
  }));
  dataset = [...burst, ...dataset];
  const previousCallCount = calls.length;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["history", "task-c"] });
    await waitUntil(() => calls.length > previousCallCount && result.current.data?.[0]?.id === burst[0]?.id);
  });
  expect(result.current.data?.length).toBeGreaterThanOrEqual(150);
  expect(previouslyLoaded.every((id) => result.current.data?.some((item) => item.id === id))).toBe(true);

  await act(async () => result.current.loadOlder());
  await act(async () => result.current.loadOlder());
  await act(async () => result.current.loadOlder());
  expect(previouslyLoaded.every((id) => result.current.data?.some((item) => item.id === id))).toBe(true);
  expect(result.current.data?.some((item) => item.id === burst[0]?.id)).toBe(true);
  expect(result.current.data?.length).toBe(217);
  expect(result.current.hasMore).toBe(true);
  expect(new Set(result.current.data?.map((item) => item.id)).size).toBe(result.current.data?.length);
});

it("does not duplicate a concurrent load and exposes an older-page error for retry", async () => {
  const dataset = makeItems(0, 123);
  const calls: Array<string | undefined> = [];
  let rejectFirst = true;
  const fetchPage = async (before?: string) => {
    calls.push(before);
    if (before && rejectFirst) {
      rejectFirst = false;
      throw new Error("older page unavailable");
    }
    return pageFrom(dataset, before);
  };
  const { result } = renderHook({ queryKey: ["history", "task-d"], fetchPage });
  await act(async () => waitUntil(() => result.current.data?.length === 50));

  await act(async () => result.current.loadOlder());
  expect(result.current.olderError).toEqual(new Error("older page unavailable"));
  expect(result.current.hasMore).toBe(true);
  await act(async () => result.current.loadOlder());
  expect(result.current.olderError).toBeNull();
  expect(result.current.data).toHaveLength(100);

  const concurrentCalls: Array<string | undefined> = [];
  let release!: (items: Item[]) => void;
  const blockingFetcher = (before?: string) => {
    concurrentCalls.push(before);
    if (!before) return Promise.resolve(pageFrom(dataset, before));
    return new Promise<Item[]>((resolve) => { release = resolve; });
  };
  const { result: concurrent } = renderHook({ queryKey: ["history", "task-e"], fetchPage: blockingFetcher });
  await act(async () => waitUntil(() => concurrent.current.data?.length === 50));
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = concurrent.current.loadOlder();
    second = concurrent.current.loadOlder();
  });
  expect(concurrent.current.isLoadingOlder).toBe(true);
  expect(concurrentCalls.filter((cursor) => cursor !== undefined)).toHaveLength(1);
  await act(async () => {
    release(pageFrom(dataset, calls[calls.length - 1]));
    await Promise.all([first, second]);
  });
  expect(concurrent.current.data).toHaveLength(100);
});

it("resets local snapshots on task navigation without showing the prior task", async () => {
  const firstDataset = makeItems(0, 123);
  const secondDataset = makeItems(300, 80);
  const firstCalls: Array<string | undefined> = [];
  const secondCalls: Array<string | undefined> = [];
  const { result, rerender } = renderHook({
    queryKey: ["history", "first-task"],
    fetchPage: pagedFetcher(firstDataset, firstCalls),
  });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  await act(async () => result.current.loadOlder());

  rerender({ queryKey: ["history", "second-task"], fetchPage: pagedFetcher(secondDataset, secondCalls) });
  await act(async () => waitUntil(() => result.current.data?.length === 50));
  expect(result.current.data?.every((item) => secondDataset.some((candidate) => candidate.id === item.id))).toBe(true);
  expect(result.current.hasMore).toBe(true);
  await act(async () => result.current.loadOlder());
  expect(secondCalls).toHaveLength(2);
  expect(firstCalls).toHaveLength(2);
});
