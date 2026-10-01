import { describe, expect, it } from "vitest";
import { ALL_INTERNAL_PERMISSIONS, ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";

describe("leave permissions catalog", () => {
  const leaveKeys = ALL_INTERNAL_PERMISSIONS.filter((k) => k.startsWith("leave."));

  it("defines the Phase 4.3 leave permission set", () => {
    expect(leaveKeys.sort()).toEqual(
      [
        "leave.adjust_balance",
        "leave.approve_manager",
        "leave.cancel_self",
        "leave.manage",
        "leave.request",
        "leave.view_all",
        "leave.view_self",
        "leave.view_team",
      ].sort(),
    );
  });

  it("grants employee self-service leave to engineer roles", () => {
    for (const role of ["engineer", "project_engineer", "document_controller", "employee"] as const) {
      expect(ROLE_PERMISSION_MAP[role]).toEqual(
        expect.arrayContaining(["leave.view_self", "leave.request", "leave.cancel_self"]),
      );
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("leave.manage");
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("leave.adjust_balance");
    }
  });

  it("grants manager approve + team view without balance adjust", () => {
    for (const role of ["department_manager", "project_manager"] as const) {
      expect(ROLE_PERMISSION_MAP[role]).toEqual(
        expect.arrayContaining([
          "leave.view_self",
          "leave.request",
          "leave.cancel_self",
          "leave.view_team",
          "leave.approve_manager",
        ]),
      );
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("leave.adjust_balance");
    }
  });

  it("grants HR manage and HR Manager adjust_balance", () => {
    expect(ROLE_PERMISSION_MAP.hr_officer).toEqual(
      expect.arrayContaining(["leave.view_all", "leave.manage"]),
    );
    expect(ROLE_PERMISSION_MAP.hr_officer).not.toContain("leave.adjust_balance");
    expect(ROLE_PERMISSION_MAP.hr_manager).toEqual(
      expect.arrayContaining(["leave.manage", "leave.adjust_balance", "leave.approve_manager"]),
    );
  });
});
