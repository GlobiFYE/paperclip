import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  heartbeatService,
  parseGlobalMaxConcurrentRuns,
} from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

// Optional gate so a test can hold a claimed run inside the adapter while it
// asserts the admission state of the other queued runs (dispatch is
// fire-and-forget, so without the gate the finalize race would be flaky).
let adapterGate: Promise<void> | null = null;

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => {
    await adapterGate;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Global concurrency cap test run.",
      provider: "test",
      model: "test-model",
    };
  }),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres global concurrency cap tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("parseGlobalMaxConcurrentRuns", () => {
  it("disables the cap for unset, empty, zero, and invalid values", () => {
    expect(parseGlobalMaxConcurrentRuns(undefined)).toBeNull();
    expect(parseGlobalMaxConcurrentRuns(null)).toBeNull();
    expect(parseGlobalMaxConcurrentRuns("")).toBeNull();
    expect(parseGlobalMaxConcurrentRuns("0")).toBeNull();
    expect(parseGlobalMaxConcurrentRuns("-3")).toBeNull();
    expect(parseGlobalMaxConcurrentRuns("unlimited")).toBeNull();
    expect(parseGlobalMaxConcurrentRuns("2.5")).toBe(2);
    expect(parseGlobalMaxConcurrentRuns("6")).toBe(6);
    expect(parseGlobalMaxConcurrentRuns(6)).toBe(6);
  });
});

describeEmbeddedPostgres("heartbeat global concurrency cap", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let heartbeat!: ReturnType<typeof heartbeatService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-global-concurrency-cap-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db, {
      runtimeEnv: { HEARTBEAT_GLOBAL_MAX_CONCURRENT_RUNS: "1" },
    });
  }, 20_000);

  afterEach(async () => {
    adapterGate = null;
    await heartbeat.drainActiveRunExecutions();
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    // Executed runs write to many company-scoped tables; clear them all.
    await db.execute(sql`truncate table ${companies} cascade`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function insertAgent(companyId: string, name: string) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
          // Per-agent headroom exists; only the fleet-wide cap can defer these.
          maxConcurrentRuns: 2,
        },
      },
      permissions: {},
    });
    return agentId;
  }

  async function insertCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Global Cap Co",
      status: "active",
      issuePrefix: `G${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function insertRun(
    companyId: string,
    agentId: string,
    status: "queued" | "running",
  ) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "on_demand",
      triggerDetail: "manual",
      status: status === "queued" ? "queued" : "claimed",
      runId,
      requestedByActorType: "user",
      requestedByActorId: "board-user",
      payload: { manualUserWake: true },
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      triggerDetail: "manual",
      status,
      wakeupRequestId,
      ...(status === "running" ? { processPid: process.pid } : {}),
      createdAt: new Date(Date.now() - 60_000),
    });
    return runId;
  }

  async function runStatus(runId: string) {
    return db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(sql`${heartbeatRuns.id} = ${runId}`)
      .then((rows) => rows[0] ?? null);
  }

  it("defers queued runs instance-wide while the fleet-wide cap is reached", async () => {
    const companyId = await insertCompany();
    const agentA = await insertAgent(companyId, "Cap Agent A");
    const agentB = await insertAgent(companyId, "Cap Agent B");
    const runningRunId = await insertRun(companyId, agentA, "running");
    const queuedA = await insertRun(companyId, agentA, "queued");
    const queuedB = await insertRun(companyId, agentB, "queued");

    await heartbeat.resumeQueuedRuns();

    // The single fleet-wide slot is held by runningRunId: both queued runs wait.
    expect(mockAdapterExecute).not.toHaveBeenCalled();
    expect(await runStatus(runningRunId)).toMatchObject({ status: "running" });
    expect(await runStatus(queuedA)).toMatchObject({ status: "queued" });
    expect(await runStatus(queuedB)).toMatchObject({ status: "queued" });
  });

  it("promotes deferred runs one at a time as fleet-wide slots free", async () => {
    let releaseClaimed!: () => void;
    adapterGate = new Promise<void>((resolve) => {
      releaseClaimed = resolve;
    });

    const companyId = await insertCompany();
    const agentA = await insertAgent(companyId, "Promote Agent A");
    const agentB = await insertAgent(companyId, "Promote Agent B");
    const runningRunId = await insertRun(companyId, agentA, "running");
    const queuedA = await insertRun(companyId, agentA, "queued");
    const queuedB = await insertRun(companyId, agentB, "queued");

    await heartbeat.resumeQueuedRuns();
    expect(await runStatus(queuedA)).toMatchObject({ status: "queued" });
    expect(await runStatus(queuedB)).toMatchObject({ status: "queued" });

    // Free the fleet-wide slot.
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(sql`${heartbeatRuns.id} = ${runningRunId}`);

    // Exactly one queued run takes the single fleet-wide slot and stays
    // running (held inside the adapter gate) while the other keeps waiting.
    await heartbeat.resumeQueuedRuns();
    const statesAfterPromotion = [await runStatus(queuedA), await runStatus(queuedB)];
    expect(
      statesAfterPromotion.filter((state) => state?.status === "running"),
    ).toHaveLength(1);
    expect(
      statesAfterPromotion.filter((state) => state?.status === "queued"),
    ).toHaveLength(1);
    // Claim is synchronous; the fire-and-forget dispatch reaches the adapter
    // a few awaits later (and then blocks on the gate).
    await vi.waitFor(() => {
      expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
    });

    // Release the claimed run; once it finishes, the next sweep pass (the
    // periodic recovery sweep in production) promotes the rest.
    releaseClaimed();
    await heartbeat.drainActiveRunExecutions();
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect(await runStatus(queuedA)).toMatchObject({ status: "succeeded" });
    expect(await runStatus(queuedB)).toMatchObject({ status: "succeeded" });
    expect(mockAdapterExecute).toHaveBeenCalledTimes(2);
  });

  it("does not defer queued runs when the fleet-wide cap is disabled", async () => {
    const uncapped = heartbeatService(db);
    const companyId = await insertCompany();
    const agentA = await insertAgent(companyId, "Uncapped Agent A");
    const agentB = await insertAgent(companyId, "Uncapped Agent B");
    await insertRun(companyId, agentA, "running");
    const queuedA = await insertRun(companyId, agentA, "queued");
    const queuedB = await insertRun(companyId, agentB, "queued");

    await uncapped.resumeQueuedRuns();
    await uncapped.drainActiveRunExecutions();

    expect(mockAdapterExecute).toHaveBeenCalledTimes(2);
    expect(await runStatus(queuedA)).toMatchObject({ status: "succeeded" });
    expect(await runStatus(queuedB)).toMatchObject({ status: "succeeded" });
  });
});
