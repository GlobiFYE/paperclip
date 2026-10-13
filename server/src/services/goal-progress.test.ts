import { describe, expect, it } from "vitest";
import { computeGoalProgress } from "./goal-progress.js";

const goal = (id: string, level: string, parentId: string | null = null, status = "active") => ({
  id, title: id, level, status, parentId, ownerAgentId: null,
});
const issue = (id: string, status: string, goalId: string | null, assigneeAgentId: string | null = null) => ({
  id, identifier: `TOP-${id}`, title: `task ${id}`, status, goalId, assigneeAgentId,
});

describe("computeGoalProgress", () => {
  it("scores a leaf goal by done over non-cancelled tasks", () => {
    const out = computeGoalProgress({
      goals: [goal("m1", "task")],
      issues: [issue("1", "done", "m1"), issue("2", "todo", "m1"), issue("3", "cancelled", "m1"), issue("4", "in_review", "m1")],
      agents: [],
    });
    const m1 = out.goals.find((g) => g.id === "m1")!;
    expect(m1.percent).toBe(33.3);
    expect(m1.counts).toEqual({ done: 1, inProgress: 0, inReview: 1, blocked: 0, todo: 1, total: 3 });
  });

  it("weights milestones equally under a team goal and rolls counts up to the company goal", () => {
    const out = computeGoalProgress({
      goals: [goal("c", "company"), goal("t", "team", "c"), goal("m1", "task", "t"), goal("m2", "task", "t")],
      issues: [issue("1", "done", "m1"), issue("2", "done", "m1"), issue("3", "todo", "m2"), issue("4", "todo", "m2"), issue("5", "todo", "m2"), issue("6", "done", "m2")],
      agents: [],
    });
    const byId = Object.fromEntries(out.goals.map((g) => [g.id, g]));
    expect(byId.m1.percent).toBe(100);
    expect(byId.m2.percent).toBe(25);
    // 2 of 6 tasks are done, but the milestones count equally: (100 + 25) / 2.
    expect(byId.t.percent).toBe(62.5);
    expect(byId.c.percent).toBe(62.5);
    expect(byId.c.counts.total).toBe(6);
    expect(out.overall.percent).toBe(62.5);
    expect(out.overall.counts.done).toBe(3);
  });

  it("treats achieved goals as 100 and ignores cancelled child goals", () => {
    const out = computeGoalProgress({
      goals: [goal("t", "team"), goal("m1", "task", "t", "achieved"), goal("m2", "task", "t", "cancelled"), goal("m3", "task", "t")],
      issues: [issue("1", "todo", "m3")],
      agents: [],
    });
    const byId = Object.fromEntries(out.goals.map((g) => [g.id, g]));
    expect(byId.m1.percent).toBe(100);
    expect(byId.t.percent).toBe(50);
  });

  it("counts open tasks with no goal and never crashes on a goal cycle", () => {
    const out = computeGoalProgress({
      goals: [goal("a", "team", "b"), goal("b", "team", "a")],
      issues: [issue("1", "todo", null), issue("2", "done", null), issue("3", "in_progress", "missing-goal")],
      agents: [],
    });
    expect(out.unlinkedOpenTasks).toBe(2);
    expect(out.goals).toHaveLength(2);
  });

  it("reports each agent's furthest-along open task with its goal", () => {
    const out = computeGoalProgress({
      goals: [goal("m1", "task")],
      issues: [
        issue("1", "todo", "m1", "agent-a"),
        issue("2", "in_progress", "m1", "agent-a"),
        issue("3", "backlog", null, "agent-b"),
        issue("4", "in_review", null, "agent-c"),
        issue("5", "done", "m1", "agent-d"),
      ],
      agents: [
        { id: "agent-a", name: "Zed", status: "running" },
        { id: "agent-b", name: "Bea", status: "idle" },
        { id: "agent-c", name: "Cal", status: "idle" },
        { id: "agent-d", name: "Dee", status: "idle" },
      ],
    });
    expect(out.agents.map((a) => [a.name, a.identifier, a.stage, a.goalTitle])).toEqual([
      ["Zed", "TOP-2", "in_progress", "m1"],
      ["Cal", "TOP-4", "in_review", null],
    ]);
  });
});
