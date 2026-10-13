import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { historyPageCursor, ISSUE_HISTORY_PAGE_SIZE, mergeIssueHistory } from "@/lib/issue-history";

type HistoryState<T> = {
  scope: string;
  head: readonly T[] | undefined;
  headBoundary: string | null;
  olderItems: readonly T[];
  before: string | null;
  hasMore: boolean;
  historyStarted: boolean;
  olderError: unknown | null;
};

export type UseIssueHistoryOptions<T> = {
  queryKey: QueryKey;
  enabled?: boolean;
  fetchPage: (before?: string) => Promise<T[]>;
  getId: (item: T) => string;
  getCreatedAt: (item: T) => string | Date;
};

export type UseIssueHistoryResult<T> = {
  data: T[] | undefined;
  isPending: UseQueryResult<T[], Error>["isPending"];
  isLoading: UseQueryResult<T[], Error>["isLoading"];
  isError: UseQueryResult<T[], Error>["isError"];
  refetch: UseQueryResult<T[], Error>["refetch"];
  hasMore: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => Promise<void>;
  olderError: unknown | null;
};

function scopeOf(queryKey: QueryKey) {
  return JSON.stringify(queryKey);
}

function emptyState<T>(scope: string): HistoryState<T> {
  return {
    scope,
    head: undefined,
    headBoundary: null,
    olderItems: [],
    before: null,
    hasMore: false,
    historyStarted: false,
    olderError: null,
  };
}

export function useIssueHistory<T>({
  queryKey,
  enabled = true,
  fetchPage,
  getId,
  getCreatedAt,
}: UseIssueHistoryOptions<T>): UseIssueHistoryResult<T> {
  const scope = scopeOf(queryKey);
  const query = useQuery<T[], Error>({
    queryKey,
    queryFn: () => fetchPage(),
    enabled,
  });
  const [storedState, setStoredState] = useState<HistoryState<T>>(() => emptyState(scope));
  const state = storedState.scope === scope ? storedState : emptyState<T>(scope);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const headRef = useRef(query.data);
  headRef.current = query.data;
  const loadingOlderScopeRef = useRef<string | null>(null);
  const [loadingOlderScope, setLoadingOlderScope] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !query.data) return;
    const nextHead = query.data;
    const nextBoundary = nextHead.length ? getId(nextHead[nextHead.length - 1]!) : null;
    setStoredState((current) => {
      const previous = current.scope === scope ? current : emptyState<T>(scope);
      if (previous.head === nextHead) return previous;

      if (!previous.head) {
        return {
          ...previous,
          head: nextHead,
          headBoundary: nextBoundary,
          before: historyPageCursor(nextHead, getId),
          hasMore: nextHead.length >= ISSUE_HISTORY_PAGE_SIZE,
        };
      }

      const shifted = previous.headBoundary !== nextBoundary;
      const olderItems = shifted && previous.historyStarted
        ? mergeIssueHistory({
            head: [],
            older: [...previous.olderItems, ...previous.head],
            getId,
            getCreatedAt,
          })
        : previous.olderItems;
      const knownIds = previous.historyStarted
        ? new Set([...previous.head, ...previous.olderItems].map(getId))
        : null;
      const overlapsKnownHistory = Boolean(
        knownIds && nextHead.some((item) => knownIds.has(getId(item))),
      );
      const opensGap = shifted && !overlapsKnownHistory;
      return {
        ...previous,
        head: nextHead,
        headBoundary: nextBoundary,
        olderItems,
        before: opensGap
          ? (nextBoundary && (
              nextHead.length >= ISSUE_HISTORY_PAGE_SIZE ||
              previous.hasMore ||
              previous.historyStarted
            ) ? nextBoundary : null)
          : previous.before,
        hasMore: opensGap
          ? Boolean(nextBoundary && (
              nextHead.length >= ISSUE_HISTORY_PAGE_SIZE ||
              previous.hasMore ||
              previous.historyStarted
            ))
          : previous.hasMore,
        olderError: null,
      };
    });
  }, [enabled, getCreatedAt, getId, query.data, scope]);

  const loadOlder = useCallback(async () => {
    const head = query.data;
    if (!enabled || !head || loadingOlderScopeRef.current === scope) return;
    const current = storedState.scope === scope ? storedState : emptyState<T>(scope);
    const headTail = head.length ? getId(head[head.length - 1]!) : null;
    const shiftedBeforeEffect = current.headBoundary !== null && current.headBoundary !== headTail;
    const before = shiftedBeforeEffect
      ? headTail
      : current.headBoundary === null
        ? historyPageCursor(head, getId)
        : current.before;
    const mayHaveOlder = shiftedBeforeEffect
      ? current.hasMore || head.length >= ISSUE_HISTORY_PAGE_SIZE
      : current.headBoundary === null
        ? head.length >= ISSUE_HISTORY_PAGE_SIZE
        : current.hasMore;
    if (!before || !mayHaveOlder) return;

    loadingOlderScopeRef.current = scope;
    setLoadingOlderScope(scope);
    setStoredState((previous) => previous.scope === scope
      ? { ...previous, historyStarted: true, olderError: null }
      : previous);
    try {
      const page = await fetchPage(before);
      if (activeScopeRef.current !== scope) return;
      setStoredState((previous) => {
        if (previous.scope !== scope) return previous;
        const currentHead = headRef.current ?? head;
        const currentHeadTail = currentHead.length
          ? getId(currentHead[currentHead.length - 1]!)
          : headTail;
        const headChangedDuringRequest = currentHeadTail !== headTail;
        const headSnapshotChanged =
          previous.headBoundary !== null && previous.headBoundary !== currentHeadTail;
        const priorItems = headSnapshotChanged && previous.head
          ? mergeIssueHistory({
              head: [],
              older: [...previous.olderItems, ...previous.head],
              getId,
              getCreatedAt,
            })
          : previous.olderItems;
        const olderItems = mergeIssueHistory({
          head: page,
          older: priorItems,
          getId,
          getCreatedAt,
        });
        const nextBefore = historyPageCursor(page, getId);
        return {
          ...previous,
          head: currentHead,
          headBoundary: currentHeadTail,
          olderItems,
          before: headChangedDuringRequest ? currentHeadTail : nextBefore,
          hasMore: headChangedDuringRequest
            ? Boolean(currentHeadTail && currentHead.length >= ISSUE_HISTORY_PAGE_SIZE)
            : nextBefore !== null,
          historyStarted: true,
          olderError: null,
        };
      });
    } catch (error) {
      if (activeScopeRef.current === scope) {
        setStoredState((previous) => previous.scope === scope
          ? { ...previous, olderError: error }
          : previous);
      }
    } finally {
      if (loadingOlderScopeRef.current === scope) {
        loadingOlderScopeRef.current = null;
        if (activeScopeRef.current === scope) setLoadingOlderScope(null);
      }
    }
  }, [enabled, fetchPage, getCreatedAt, getId, query.data, scope, storedState]);

  const data = useMemo(() => query.data
    ? mergeIssueHistory({ head: query.data, older: state.olderItems, getId, getCreatedAt })
    : undefined,
  [getCreatedAt, getId, query.data, state.olderItems]);

  const headTail = query.data?.length ? getId(query.data[query.data.length - 1]!) : null;
  const headNotObservedYet = Boolean(query.data && state.headBoundary === null);
  const headShifted = Boolean(
    query.data && state.headBoundary !== null && state.headBoundary !== headTail,
  );
  const hasMore = Boolean(query.data && (
    headShifted
      ? (headTail && (state.hasMore || query.data.length >= ISSUE_HISTORY_PAGE_SIZE))
      : headNotObservedYet
        ? query.data.length >= ISSUE_HISTORY_PAGE_SIZE
        : state.before || state.hasMore
  ));

  return {
    data,
    isPending: query.isPending,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    hasMore,
    isLoadingOlder: loadingOlderScope === scope,
    loadOlder,
    olderError: state.olderError,
  };
}
