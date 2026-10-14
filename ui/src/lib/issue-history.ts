export const ISSUE_HISTORY_PAGE_SIZE = 50;

export function mergeIssueHistory<T>(params: {
  head: readonly T[];
  older: readonly T[];
  getId: (item: T) => string;
  getCreatedAt: (item: T) => string | Date;
}): T[] {
  const byId = new Map<string, T>();

  for (const item of params.older) byId.set(params.getId(item), item);
  for (const item of params.head) byId.set(params.getId(item), item);

  return [...byId.values()].sort((left, right) => {
    const leftTime = new Date(params.getCreatedAt(left)).getTime();
    const rightTime = new Date(params.getCreatedAt(right)).getTime();
    const timeOrder = (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0);
    if (timeOrder !== 0) return timeOrder;
    return params.getId(right).localeCompare(params.getId(left));
  });
}

export function historyPageCursor<T>(
  page: readonly T[] | undefined,
  getId: (item: T) => string,
  pageSize = ISSUE_HISTORY_PAGE_SIZE,
): string | null {
  if (!page || page.length < pageSize) return null;
  return getId(page[page.length - 1]!);
}
