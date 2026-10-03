// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, FocusDashboardSummary } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";
import { derivePausedAgentBanner, Dashboard } from "./Dashboard";

const mockDashboardApi = vi.hoisted(() => ({
  summary: vi.fn(),
  focus: vi.fn(),
}));

const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
  respondToInteraction: vi.fn(),
}));

vi.mock("../api/dashboard", () => ({
  dashboardApi: mockDashboardApi,
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../api/activity", () => ({
  activityApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/access", () => ({
  accessApi: { listUserDirectory: vi.fn().mockResolvedValue({ users: [] }) },
}));

vi.mock("../api/issues", () => ({
  issuesApi: mockIssuesApi,
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: vi.fn().mockResolvedValue([]), resume: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../api/projects", () => ({
  projectsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to} data-testid="router-link">
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/dashboard", search: "", hash: "" }),
  Navigate: () => <div data-testid="navigate" />,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "co-1", companies: [] }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openOnboarding: vi.fn() }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../hooks/useSharedPolling", () => ({
  useSharedPollingQuery: () => ({}),
  usePublishSharedQueryData: () => {},
}));

vi.mock("../components/ActiveAgentsPanel", () => ({
  ActiveAgentsPanel: () => <div data-testid="active-agents-panel" />,
}));

vi.mock("../components/SmokeLabDashboardCard", () => ({
  SmokeLabDashboardCard: () => null,
}));

vi.mock("@/plugins/slots", () => ({
  PluginSlotOutlet: () => null,
}));

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    name: "Agent",
    status: "idle",
    pauseReason: null,
    ...overrides,
  } as unknown as Agent;
}

const classicSummary = {
  agents: { active: 1, running: 0, paused: 0, error: 0 },
  tasks: { inProgress: 0, open: 0, blocked: 0 },
  costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 },
  pendingApprovals: 0,
  budgets: { activeIncidents: 0, pausedAgents: 0, pausedProjects: 0, pendingApprovals: 0 },
  runActivity: [],
};

const now = new Date().toISOString();

// Multi-lane focus payload (GET /dashboard/focus): two lanes, one task each,
// the first task carrying a nested pending QuestionPreview. The project
// color is a CSS-var reference — the token-gate-safe dynamic style value —
// so the fixture itself stays free of raw hex literals.
const focusSummary: FocusDashboardSummary = {
  lanes: [
    {
      project: {
        id: "proj-1",
        name: "Launch Website",
        description: "Ship the marketing site",
        status: "in_progress",
        zone: "b",
        color: "var(--status-agent-running)",
        icon: "rocket",
      },
      nextSteps: [
        {
          id: "i-1",
          identifier: "LW-1",
          title: "Wire up the contact form",
          status: "in_progress",
          priority: null,
          assigneeAgentId: null,
          assigneeUserId: null,
          updatedAt: now,
          questions: [
            {
              interactionId: "ix-1",
              questionId: "q-1",
              prompt: "Which provider should the contact form use?",
              options: [
                { id: "opt-1", label: "Paperclip Forms" },
                { id: "opt-2", label: "Plain mailto" },
              ],
            },
          ],
        },
      ],
      laneActivity: [
        {
          id: "act-1",
          companyId: "co-1",
          actorType: "system",
          actorId: "test",
          agentId: null,
          runId: null,
          action: "issue.created",
          entityType: "issue",
          entityId: "i-1",
          createdAt: new Date(now),
          details: { issueTitle: "Wire up the contact form" },
        },
      ],
    },
    {
      project: {
        id: "proj-2",
        name: "Crew Blog",
        description: null,
        status: "planned",
        zone: "b",
        color: null,
        icon: null,
      },
      nextSteps: [
        {
          id: "i-2",
          identifier: "CB-1",
          title: "Draft the launch copy",
          status: "todo",
          priority: null,
          assigneeAgentId: null,
          assigneeUserId: null,
          updatedAt: now,
          questions: [],
        },
      ],
      laneActivity: [],
    },
  ],
};

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("Dashboard focus surface (enableFocusDashboard)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let queryClient: QueryClient;

  async function renderDashboard() {
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Dashboard />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockDashboardApi.summary.mockResolvedValue(classicSummary);
    mockDashboardApi.focus.mockResolvedValue(focusSummary);
    mockIssuesApi.list.mockResolvedValue([]);
    mockIssuesApi.respondToInteraction.mockResolvedValue({});
  });

  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("renders one lane card per project when the flag is on", async () => {
    queryClient.setQueryData(queryKeys.instance.experimentalSettings, {
      enableFocusDashboard: true,
    });
    queryClient.setQueryData(queryKeys.dashboardFocus("co-1"), focusSummary);
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableFocusDashboard: true });

    await renderDashboard();

    const text = container.textContent ?? "";
    // Active-lane HQ: every lane's project front and center, one card each.
    expect(text).toContain("Launch Website");
    expect(text).toContain("Ship the marketing site");
    expect(text).toContain("Crew Blog");
    expect(text).toContain("Next steps");
    // Each lane's own next steps render, linked to their issues.
    expect(text).toContain("Wire up the contact form");
    expect(text).toContain("Draft the launch copy");
    const laneCards = container.querySelectorAll('[data-testid="focus-lane"]');
    expect(laneCards.length).toBe(2);
    const laneIssueLinks = [...container.querySelectorAll('a[data-testid="router-link"]')]
      .map((link) => link.getAttribute("href"));
    expect(laneIssueLinks).toContain("/issues/LW-1");
    expect(laneIssueLinks).toContain("/issues/CB-1");
    // Classic-only surfaces stay out of the focus mode.
    expect(text).not.toContain("Run Activity");
    expect(text).not.toContain("Recent Tasks");
    expect(text).not.toContain("Agents Enabled");
  });

  it("nests a pending question under its task and posts the one-tap answer", async () => {
    queryClient.setQueryData(queryKeys.instance.experimentalSettings, {
      enableFocusDashboard: true,
    });
    queryClient.setQueryData(queryKeys.dashboardFocus("co-1"), focusSummary);
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableFocusDashboard: true });

    await renderDashboard();

    // The question preview renders nested under its next step.
    const text = container.textContent ?? "";
    expect(text).toContain("Which provider should the contact form use?");
    expect(text).toContain("Paperclip Forms");
    expect(text).toContain("Plain mailto");

    // One tap on an option posts the answer through the same mutation the
    // issue-thread interaction card uses (respondToInteraction).
    const optionButtons = [...container.querySelectorAll<HTMLButtonElement>(
      'button[data-testid="focus-lane-question-option"]',
    )];
    expect(optionButtons.length).toBe(2);
    const formsOption = optionButtons.find((button) => button.textContent === "Paperclip Forms");
    expect(formsOption).toBeDefined();

    flushSync(() => {
      formsOption!.click();
    });
    await flushReact();
    await flushReact();

    expect(mockIssuesApi.respondToInteraction).toHaveBeenCalledTimes(1);
    expect(mockIssuesApi.respondToInteraction).toHaveBeenCalledWith("i-1", "ix-1", {
      answers: [{ questionId: "q-1", optionIds: ["opt-1"] }],
    });
  });

  it("renders the calm no-active-lane empty state when focus has no lanes", async () => {
    queryClient.setQueryData(queryKeys.instance.experimentalSettings, {
      enableFocusDashboard: true,
    });
    const emptyFocus: FocusDashboardSummary = { lanes: [] };
    queryClient.setQueryData(queryKeys.dashboardFocus("co-1"), emptyFocus);
    mockDashboardApi.focus.mockResolvedValue(emptyFocus);
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableFocusDashboard: true });

    await renderDashboard();

    const text = container.textContent ?? "";
    expect(text).toContain("No active lane");
    expect(text).toContain("Open projects");
    // Muted, not an error surface: no destructive copy, no classic charts.
    expect(text).not.toContain("Run Activity");
  });

  it("renders the classic dashboard unchanged when the flag is off", async () => {
    queryClient.setQueryData(queryKeys.instance.experimentalSettings, {});
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({});

    await renderDashboard();

    const text = container.textContent ?? "";
    // Classic surfaces render.
    expect(text).toContain("Recent Tasks");
    expect(text).toContain("Agents Enabled");
    // Focus content stays absent.
    expect(text).not.toContain("Launch Website");
    expect(text).not.toContain("Next steps");
    expect(text).not.toContain("Lane activity");
  });
});

describe("derivePausedAgentBanner", () => {
  it("returns null with no agents loaded or an empty company", () => {
    expect(derivePausedAgentBanner(undefined)).toBeNull();
    expect(derivePausedAgentBanner([])).toBeNull();
  });

  it("prefers the imported banner and lists only import-paused agents", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "import" }),
      agent({ id: "b", status: "paused", pauseReason: "manual" }),
      agent({ id: "c", status: "idle" }),
    ]);
    expect(banner).toEqual({ kind: "imported", pausedImportedAgentIds: ["a"] });
  });

  it("falls back to the all-paused banner when no import pauses exist", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "manual" }),
      agent({ id: "b", status: "paused", pauseReason: "system" }),
    ]);
    expect(banner).toEqual({ kind: "all-paused" });
  });

  it("shows nothing while at least one agent can run and none are import-paused", () => {
    const banner = derivePausedAgentBanner([
      agent({ id: "a", status: "paused", pauseReason: "manual" }),
      agent({ id: "b", status: "idle" }),
    ]);
    expect(banner).toBeNull();
  });
});
