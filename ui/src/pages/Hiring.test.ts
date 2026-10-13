import { describe, expect, it } from "vitest";
import { pendingHires } from "./Hiring";

describe("pendingHires", () => {
  it("keeps only pending hire_agent approvals", () => {
    const list = [
      { id: "1", type: "hire_agent", status: "pending" },
      { id: "2", type: "hire_agent", status: "approved" },
      { id: "3", type: "budget_override_required", status: "pending" },
      { id: "4", type: "hire_agent", status: "revision_requested" },
    ];
    expect(pendingHires(list).map((a) => a.id)).toEqual(["1"]);
  });
  it("handles a missing list", () => {
    expect(pendingHires(undefined)).toEqual([]);
  });
});
