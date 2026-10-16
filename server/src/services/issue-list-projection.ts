/**
 * Pure helpers for what an issue read actually carries.
 *
 * Both of these exist because of the same defect class (LAC-4464): a key whose value is
 * `null`, or a key that is not there at all, is indistinguishable from "this issue has
 * nothing set" to every caller, including `jq .field` and `dict.get(field)`. An agent read
 * `executionPolicy: null` off the issue list and concluded the QA approval gate it had
 * just created had been dropped; the gate was there, the list simply does not load it.
 *
 * They live in their own module rather than in `services/issues.ts` on purpose: route
 * tests mock `../services/issues.js` down to `issueService` alone, so a route that
 * imported a pure helper from there would be undefined under test and 500 in production
 * only once someone tightened a mock.
 */

/**
 * The fields `issueListSelect` fills with a placeholder `null` instead of the stored
 * value. They are stripped from list responses so an absent key reads as "ask the issue
 * endpoint", never as "not set". Anything added to that projection as a placeholder
 * rather than a value belongs here too.
 */
export const ISSUE_LIST_UNLOADED_FIELDS = [
  "executionPolicy",
  "executionState",
  "executionWorkspaceSettings",
] as const;

type IssueListUnloadedField = (typeof ISSUE_LIST_UNLOADED_FIELDS)[number];

export function omitUnloadedIssueListFields<T extends object>(row: T): Omit<T, IssueListUnloadedField> {
  const copy = { ...row } as Record<string, unknown>;
  for (const field of ISSUE_LIST_UNLOADED_FIELDS) {
    delete copy[field];
  }
  return copy as Omit<T, IssueListUnloadedField>;
}

/**
 * `blockedByIssueIds` is a write-only input on create and update: it is fanned out to the
 * issue relation table and never stored on the issue row. Reads that carry `blockedBy`
 * echo the ids back through this helper, so the field a caller writes is a field it can
 * read, derived from the same array so the two cannot disagree.
 */
export function blockedByIssueIdsFromRelations(blockedBy: readonly { id: string }[]): string[] {
  return blockedBy.map((relation) => relation.id);
}
