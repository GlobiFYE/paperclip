import type { Request, Response, RequestHandler } from "express";
import type { Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ decide: vi.fn(), list: vi.fn() }));
vi.mock("./index.js", () => ({
  accessService: () => ({ decide: mocks.decide }),
  deliverablesService: () => ({ list: mocks.list }),
  agentService: () => ({}), budgetService: () => ({}), companyArtifactsService: () => ({}),
  companyPortabilityService: () => ({}), companyService: () => ({}), feedbackService: () => ({}),
}));
import { companyRoutes } from "../routes/companies.js";

const companyId = "11111111-1111-4111-8111-111111111111";
async function requestDeliverables(actor: Request["actor"]) {
  const router = companyRoutes({} as Db);
  const layer = router.stack.find(layer => layer.route?.path === "/:companyId/deliverables")!;
  const handler = layer.route!.stack[0].handle as RequestHandler;
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await handler({ actor, params: { companyId }, query: {} } as unknown as Request, response as unknown as Response, vi.fn());
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.decide.mockResolvedValue({ allowed: true });
  mocks.list.mockResolvedValue({ summariesEnabled: false, deliverables: [], nextCursor: null });
});
describe("deliverables route authorization", () => {
  it("denies a low-trust agent's company-wide read before loading evidence", async () => {
    const actor: Request["actor"] = { type: "agent", agentId: "agent", companyId, source: "agent_key" };
    mocks.decide.mockResolvedValue({ allowed: false, reason: "deny_low_trust_boundary" });
    const response = await requestDeliverables(actor);
    expect(mocks.decide).toHaveBeenCalledWith({ actor, action: "company_scope:read", resource: { type: "company", companyId } });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects task-bridge keys even when the company scope decision would allow access", async () => {
    const response = await requestDeliverables({ type: "agent", agentId: "agent", companyId, source: "agent_key",
      keyScope: { kind: "task_bridge", issueId: "issue" } } as Request["actor"]);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("allows an authorized board read", async () => {
    const response = await requestDeliverables({ type: "board", source: "local_implicit", userId: "operator", companyIds: [companyId] });
    expect(mocks.decide).toHaveBeenCalledOnce();
    expect(mocks.list).toHaveBeenCalledWith(companyId, { limit: 30 });
    expect(response.json).toHaveBeenCalledWith({ summariesEnabled: false, deliverables: [], nextCursor: null });
  });
});
