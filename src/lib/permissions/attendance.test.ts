import { describe, expect, it } from "vitest";
import { ALL_INTERNAL_PERMISSIONS, ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";

describe("attendance permissions catalog", () => {
  const keys = ALL_INTERNAL_PERMISSIONS.filter((k) => k.startsWith("attendance."));

  it("defines Phase 4.4 attendance permission set", () => {
    expect(keys.sort()).toEqual(
      [
        "attendance.adjust",
        "attendance.check_in",
        "attendance.check_out",
        "attendance.manage",
        "attendance.manage_policies",
        "attendance.manage_shifts",
        "attendance.view_all",
        "attendance.view_self",
        "attendance.view_team",
      ].sort(),
    );
  });

  it("grants self check-in/out to engineer roles", () => {
    for (const role of ["engineer", "project_engineer", "document_controller"] as const) {
      expect(ROLE_PERMISSION_MAP[role]).toEqual(
        expect.arrayContaining(["attendance.view_self", "attendance.check_in", "attendance.check_out"]),
      );
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("attendance.adjust");
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("attendance.manage_policies");
    }
  });

  it("grants managers team view without adjust", () => {
    for (const role of ["department_manager", "project_manager"] as const) {
      expect(ROLE_PERMISSION_MAP[role]).toEqual(
        expect.arrayContaining([
          "attendance.view_self",
          "attendance.check_in",
          "attendance.check_out",
          "attendance.view_team",
        ]),
      );
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("attendance.adjust");
    }
  });

  it("grants HR officer manage/adjust and HR manager policies/shifts", () => {
    expect(ROLE_PERMISSION_MAP.hr_officer).toEqual(
      expect.arrayContaining(["attendance.view_all", "attendance.manage", "attendance.adjust"]),
    );
    expect(ROLE_PERMISSION_MAP.hr_manager).toEqual(
      expect.arrayContaining([
        "attendance.manage",
        "attendance.adjust",
        "attendance.manage_policies",
        "attendance.manage_shifts",
      ]),
    );
  });
});
