import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { deliverablesApi, type CompanyDeliverable } from "./deliverables";

function sampleDeliverable(overrides: Partial<CompanyDeliverable> = {}): CompanyDeliverable {
  return {
    id: "d-1",
    summary: "Done.",
    generationStatus: "generated",
    issue: { id: "issue-1", identifier: "T-1", title: "Ship the thing" },
    project: null,
    product: null,
    doneBy: null,
    verifiedBy: null,
    completedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("deliverablesApi.list", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
  });

  it("builds the company-scoped deliverables query", async () => {
    mockApi.get.mockResolvedValue({ deliverables: [], nextCursor: null });
    await deliverablesApi.list("company-1", {
      projectId: "proj-1",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-12T00:00:00.000Z",
      limit: 30,
      cursor: "abc",
    });
    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/deliverables?projectId=proj-1&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-12T00%3A00%3A00.000Z&limit=30&cursor=abc",
    );
  });

  it("omits empty filters from the query string", async () => {
    mockApi.get.mockResolvedValue({ deliverables: [], nextCursor: null });
    await deliverablesApi.list("company-1");
    expect(mockApi.get).toHaveBeenCalledWith("/companies/company-1/deliverables");
  });

  it("normalizes a bare array response", async () => {
    mockApi.get.mockResolvedValue([sampleDeliverable()]);
    const result = await deliverablesApi.list("company-1");
    expect(result.deliverables).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("keeps the envelope shape when the server returns one", async () => {
    mockApi.get.mockResolvedValue({
      deliverables: [sampleDeliverable()],
      nextCursor: "cursor-2",
    });
    const result = await deliverablesApi.list("company-1");
    expect(result.deliverables).toHaveLength(1);
    expect(result.nextCursor).toBe("cursor-2");
  });
});
