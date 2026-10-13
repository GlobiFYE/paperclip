import { describe, expect, it } from "vitest";
import type { CurrentBoardAccess } from "../api/access";
import { canBoardConfirmWorkspaceOwnerStop, canBoardManageRuntime } from "./recovery-reconcile";

const access: CurrentBoardAccess = { companyIds: ["company"], memberships: [],
  isInstanceAdmin: false, source: "session", userId: "user", user: null, keyId: null };

describe("workspace owner stop permissions", () => {
  it.each(["owner", "admin", "operator", "member", "viewer", null] as const)("requires an administrator instead of ordinary %s runtime access", membershipRole => {
    const board = { ...access, memberships: [{ companyId: "company", membershipRole, status: "active" as const }] };
    expect(canBoardConfirmWorkspaceOwnerStop("company", board)).toBe(membershipRole === "owner" || membershipRole === "admin");
    if (membershipRole === "operator" || membershipRole === "member") expect(canBoardManageRuntime("company", board)).toBe(true);
    expect(canBoardConfirmWorkspaceOwnerStop("other-company", board)).toBe(false);
  });
  it("denies unknown and suspended roles instead of falling back to company visibility", () => {
    expect(canBoardConfirmWorkspaceOwnerStop("company", access)).toBe(false);
    expect(canBoardConfirmWorkspaceOwnerStop("company", undefined)).toBe(false);
    expect(canBoardConfirmWorkspaceOwnerStop("company", { ...access,
      memberships: [{ companyId: "company", membershipRole: "owner", status: "suspended" }] })).toBe(false);
  });
  it("allows the trusted local board and instance administrator", () => {
    expect(canBoardConfirmWorkspaceOwnerStop("company", { ...access, source: "local_implicit" })).toBe(true);
    expect(canBoardConfirmWorkspaceOwnerStop("company", { ...access, isInstanceAdmin: true })).toBe(true);
    expect(canBoardConfirmWorkspaceOwnerStop(null, { ...access, isInstanceAdmin: true })).toBe(false);
  });
});
