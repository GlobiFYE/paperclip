import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, issues, projectGoals, projects } from "@paperclipai/db";
import type {
  GoalProgressAgent,
  GoalProgressCounts,
  GoalProgressGoal,
  GoalProgressResponse,
  GoalProgressStage,
} from "@paperclipai/shared";
import { executionIssueCondition } from "./issue-visibility.js";

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
  projectId: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
}

export interface ProgressProjectInput {
  id: string;
  /** The project's primary goal: `projects.goalId`, else its earliest `project_goals` link. */
  goalId: string | null;
}

export interface ProgressAgentInput {
  id: string;
  name: string;
  status: string;
}

const OPEN_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "blocked"]);
// The agent's "current" task is the one furthest along.
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
 *
 * A task's goal is its own goalId, else the nearest ancestor task's goal, else
 * its project's primary goal: projects linked to a goal after their tasks were
 * created never get a per-task backfill, so the fallback keeps that work on the
 * board instead of calling it "no goal".
 */
export function computeGoalProgress(input: {
  goals: ProgressGoalInput[];
  issues: ProgressIssueInput[];
  agents: ProgressAgentInput[];
  projects?: ProgressProjectInput[];
}): GoalProgressResponse {
  const own = new Map<string, GoalProgressCounts>();
  const children = new Map<string, string[]>();
  for (const goal of input.goals) {
    own.set(goal.id, emptyCounts());
    if (goal.parentId) children.set(goal.parentId, [...(children.get(goal.parentId) ?? []), goal.id]);
  }

  const projectGoal = new Map<string, string | null>((input.projects ?? []).map((project) => [project.id, project.goalId]));
  const issueById = new Map(input.issues.map((issue) => [issue.id, issue]));
  const effective = new Map<string, string | null>();
  const resolveGoal = (issue: ProgressIssueInput, trail = new Set<string>()): string | null => {
    if (effective.has(issue.id)) return effective.get(issue.id)!;
    let goalId: string | null = issue.goalId && own.has(issue.goalId) ? issue.goalId : null;
    if (!goalId && issue.parentId && !trail.has(issue.id)) {
      const parent = issueById.get(issue.parentId);
      if (parent) goalId = resolveGoal(parent, new Set(trail).add(issue.id));
    }
    if (!goalId && issue.projectId) {
      const fromProject = projectGoal.get(issue.projectId) ?? null;
      goalId = fromProject && own.has(fromProject) ? fromProject : null;
    }
    effective.set(issue.id, goalId);
    return goalId;
  };

  let unlinkedOpenTasks = 0;
  for (const issue of input.issues) {
    const goalId = resolveGoal(issue);
    if (goalId) addIssue(own.get(goalId)!, issue.status);
    else if (OPEN_STATUSES.has(issue.status)) unlinkedOpenTasks += 1;
  }

  const byId = new Map(input.goals.map((goal) => [goal.id, goal]));
  // Every goal reachable below `id` through child links, each exactly once. A
  // goal tree can hold a cycle (parent updates are not cycle-checked), so this
  // never caches a partial traversal: counts are the same whatever the input order.
  const descendants = new Map<string, Set<string>>();
  const reach = (id: string): Set<string> => {
    const cached = descendants.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [...(children.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(children.get(next) ?? []));
    }
    descendants.set(id, seen);
    return seen;
  };
  const subtree = new Map<string, GoalProgressCounts>();
  for (const goal of input.goals) {
    const counts = { ...own.get(goal.id)! };
    for (const id of reach(goal.id)) if (id !== goal.id) mergeCounts(counts, own.get(id)!);
    subtree.set(goal.id, counts);
  }
  // Percent: achieved = 100; a goal with live children = mean of its children,
  // except a child that leads back to this goal (a cycle), which is skipped so
  // the score is deterministic; otherwise the leaf rule over subtree counts.
  const percent = new Map<string, number>();
  const score = (id: string, stack: Set<string>): number => {
    const cached = percent.get(id);
    if (cached !== undefined) return cached;
    const goal = byId.get(id)!;
    const counts = subtree.get(id)!;
    let value: number;
    if (goal.status === "achieved") value = 100;
    else {
      const live = (children.get(id) ?? []).filter((childId) => byId.get(childId)?.status !== "cancelled" && !stack.has(childId) && !reach(childId).has(id));
      if (live.length > 0) {
        const inner = new Set(stack).add(id);
        value = live.reduce((sum, childId) => sum + score(childId, inner), 0) / live.length;
      } else value = counts.total > 0 ? (counts.done / counts.total) * 100 : 0;
    }
    const rounded = round1(value);
    percent.set(id, rounded);
    return rounded;
  };
  for (const goal of input.goals) score(goal.id, new Set());

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
      const goalId = resolveGoal(issue);
      return {
        agentId,
        name: agent.name,
        agentStatus: agent.status,
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stage: stageOf(issue.status),
        goalId,
        goalTitle: goalId ? goalTitle.get(goalId) ?? null : null,
      };
    })
    .sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || a.name.localeCompare(b.name));

  return { overall: { percent: overallPercent, counts: overallCounts }, goals: goalsOut, agents: agentsOut, unlinkedOpenTasks };
}

export function goalProgressService(db: Db) {
  return {
    summary: async (companyId: string): Promise<GoalProgressResponse> => {
      const [goalRows, issueRows, agentRows, projectRows] = await Promise.all([
        db
          .select({ id: goals.id, title: goals.title, level: goals.level, status: goals.status, parentId: goals.parentId, ownerAgentId: goals.ownerAgentId })
          .from(goals)
          .where(eq(goals.companyId, companyId)),
        db
          .select({
            id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status,
            goalId: issues.goalId, projectId: issues.projectId, parentId: issues.parentId, assigneeAgentId: issues.assigneeAgentId,
          })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), executionIssueCondition())),
        db.select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(eq(agents.companyId, companyId)),
        db.select({ id: projects.id, goalId: projects.goalId }).from(projects).where(eq(projects.companyId, companyId)),
      ]);
      const projectIds = projectRows.map((project) => project.id);
      const linkRows = projectIds.length === 0
        ? []
        : await db
            .select({ projectId: projectGoals.projectId, goalId: projectGoals.goalId, createdAt: projectGoals.createdAt })
            .from(projectGoals)
            .where(inArray(projectGoals.projectId, projectIds));
      const earliestLink = new Map<string, { goalId: string; createdAt: Date }>();
      for (const link of linkRows) {
        const existing = earliestLink.get(link.projectId);
        if (!existing || link.createdAt < existing.createdAt) earliestLink.set(link.projectId, { goalId: link.goalId, createdAt: link.createdAt });
      }
      const projectInputs: ProgressProjectInput[] = projectRows.map((project) => ({
        id: project.id,
        goalId: project.goalId ?? earliestLink.get(project.id)?.goalId ?? null,
      }));
      return computeGoalProgress({ goals: goalRows, issues: issueRows, agents: agentRows, projects: projectInputs });
    },
  };
}
