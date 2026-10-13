import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, issues } from "@paperclipai/db";
import { executionIssueCondition } from "./issue-visibility.js";
import type {
  GoalProgressAgent,
  GoalProgressCounts,
  GoalProgressGoal,
  GoalProgressResponse,
  GoalProgressStage,
} from "@paperclipai/shared";

export interface ProgressGoalInput {
  id: string;
  title: string;
  level: string;
  status: string;
  parentId: string | null;
  ownerAgentId: string | null;
}

export interface ProgressIssueInput {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  goalId: string | null;
  assigneeAgentId: string | null;
}

export interface ProgressAgentInput {
  id: string;
  name: string;
  status: string;
}

const OPEN_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);
// The agent's "current" task is the one furthest along; ties go to the newest id order.
const STAGE_RANK: Record<GoalProgressStage, number> = { in_progress: 4, in_review: 3, blocked: 2, todo: 1, done: 0 };

function emptyCounts(): GoalProgressCounts {
  return { done: 0, inProgress: 0, inReview: 0, blocked: 0, todo: 0, total: 0 };
}

function addIssue(counts: GoalProgressCounts, status: string) {
  if (status === "cancelled") return;
  counts.total += 1;
  if (status === "done") counts.done += 1;
  else if (status === "in_progress") counts.inProgress += 1;
  else if (status === "in_review") counts.inReview += 1;
  else if (status === "blocked") counts.blocked += 1;
  else counts.todo += 1;
}

function mergeCounts(into: GoalProgressCounts, from: GoalProgressCounts) {
  into.done += from.done;
  into.inProgress += from.inProgress;
  into.inReview += from.inReview;
  into.blocked += from.blocked;
  into.todo += from.todo;
  into.total += from.total;
}

function stageOf(status: string): GoalProgressStage {
  if (status === "in_progress" || status === "in_review" || status === "blocked" || status === "done") return status;
  return "todo";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Rolls task status up the goal tree. A goal with child goals scores the mean
 * of its live children (equal weight per milestone); a leaf goal scores
 * done / total over its own tasks; an achieved goal is 100 regardless.
 */
export function computeGoalProgress(input: {
  goals: ProgressGoalInput[];
  issues: ProgressIssueInput[];
  agents: ProgressAgentInput[];
}): GoalProgressResponse {
  const own = new Map<string, GoalProgressCounts>();
  const children = new Map<string, string[]>();
  for (const goal of input.goals) {
    own.set(goal.id, emptyCounts());
    if (goal.parentId) children.set(goal.parentId, [...(children.get(goal.parentId) ?? []), goal.id]);
  }
  let unlinkedOpenTasks = 0;
  for (const issue of input.issues) {
    if (issue.goalId && own.has(issue.goalId)) addIssue(own.get(issue.goalId)!, issue.status);
    else if (OPEN_STATUSES.has(issue.status)) unlinkedOpenTasks += 1;
  }

  const byId = new Map(input.goals.map((goal) => [goal.id, goal]));
  const subtree = new Map<string, GoalProgressCounts>();
  const percent = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (id: string): void => {
    if (subtree.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const goal = byId.get(id)!;
    const counts = { ...own.get(id)! };
    const live = (children.get(id) ?? []).filter((childId) => byId.get(childId)?.status !== "cancelled");
    for (const childId of children.get(id) ?? []) {
      resolve(childId);
      mergeCounts(counts, subtree.get(childId) ?? emptyCounts());
    }
    let score: number;
    if (goal.status === "achieved") score = 100;
    else if (live.length > 0) score = live.reduce((sum, childId) => sum + (percent.get(childId) ?? 0), 0) / live.length;
    else score = counts.total > 0 ? (counts.done / counts.total) * 100 : 0;
    subtree.set(id, counts);
    percent.set(id, round1(score));
    visiting.delete(id);
  };
  for (const goal of input.goals) resolve(goal.id);

  const goalsOut: GoalProgressGoal[] = input.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    level: goal.level,
    status: goal.status,
    parentId: goal.parentId,
    ownerAgentId: goal.ownerAgentId,
    percent: percent.get(goal.id) ?? 0,
    counts: subtree.get(goal.id) ?? emptyCounts(),
    childIds: children.get(goal.id) ?? [],
  }));

  const roots = goalsOut.filter((goal) => goal.status !== "cancelled" && (goal.parentId === null || !byId.has(goal.parentId)));
  const companyRoots = roots.filter((goal) => goal.level === "company");
  const top = companyRoots.length > 0 ? companyRoots : roots;
  const overallCounts = emptyCounts();
  for (const goal of top) mergeCounts(overallCounts, goal.counts);
  const overallPercent = top.length > 0 ? round1(top.reduce((sum, goal) => sum + goal.percent, 0) / top.length) : 0;

  const goalTitle = new Map(input.goals.map((goal) => [goal.id, goal.title]));
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const current = new Map<string, ProgressIssueInput>();
  for (const issue of input.issues) {
    if (!issue.assigneeAgentId || !agentById.has(issue.assigneeAgentId)) continue;
    if (!OPEN_STATUSES.has(issue.status) || issue.status === "backlog") continue;
    const existing = current.get(issue.assigneeAgentId);
    if (!existing || STAGE_RANK[stageOf(issue.status)] > STAGE_RANK[stageOf(existing.status)]) {
      current.set(issue.assigneeAgentId, issue);
    }
  }
  const agentsOut: GoalProgressAgent[] = [...current.entries()]
    .map(([agentId, issue]) => {
      const agent = agentById.get(agentId)!;
      return {
        agentId,
        name: agent.name,
        agentStatus: agent.status,
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stage: stageOf(issue.status),
        goalId: issue.goalId,
        goalTitle: issue.goalId ? goalTitle.get(issue.goalId) ?? null : null,
      };
    })
    .sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || a.name.localeCompare(b.name));

  return { overall: { percent: overallPercent, counts: overallCounts }, goals: goalsOut, agents: agentsOut, unlinkedOpenTasks };
}

export function goalProgressService(db: Db) {
  return {
    summary: async (companyId: string): Promise<GoalProgressResponse> => {
      const [goalRows, issueRows, agentRows] = await Promise.all([
        db
          .select({ id: goals.id, title: goals.title, level: goals.level, status: goals.status, parentId: goals.parentId, ownerAgentId: goals.ownerAgentId })
          .from(goals)
          .where(eq(goals.companyId, companyId)),
        db
          .select({ id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status, goalId: issues.goalId, assigneeAgentId: issues.assigneeAgentId })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), executionIssueCondition())),
        db.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(eq(agents.companyId, companyId)),
      ]);
      return computeGoalProgress({ goals: goalRows, issues: issueRows, agents: agentRows });
    },
  };
}
