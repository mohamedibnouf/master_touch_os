import { describe, expect, it } from "vitest";
import { deriveEmployeeSetupRows } from "@/lib/hr/employee-setup";
import { isOperationalAssignableRole, isPrivilegedRoleCode } from "@/lib/hr/roles";

describe("employee setup checklist", () => {
  it("marks only real flags as complete/ready", () => {
    const rows = deriveEmployeeSetupRows({
      employeeId: "e1",
      hasCoreIdentity: true,
      loginStatus: "not_provisioned",
      hasDepartment: false,
      hasRole: false,
      hasWorkplaceAssignment: false,
      hasShiftAssignment: false,
      hasLeaveTypes: true,
      hasCompensation: false,
    });
    expect(rows.find((r) => r.key === "core")?.statusLabel).toBe("مكتمل");
    expect(rows.find((r) => r.key === "login")?.statusLabel).toBe("غير مفعّل");
    expect(rows.find((r) => r.key === "department")?.href).toContain("tab=organization");
    expect(rows.find((r) => r.key === "leave")?.statusLabel).toBe("يحتاج إعداد");
    expect(rows.find((r) => r.key === "payroll")?.href).toContain("tab=compensation");
  });

  it("treats leave as ready only when org types exist and a role is assigned", () => {
    const ready = deriveEmployeeSetupRows({
      employeeId: "e1",
      hasCoreIdentity: true,
      loginStatus: "ready",
      hasDepartment: true,
      hasRole: true,
      hasWorkplaceAssignment: true,
      hasShiftAssignment: true,
      hasLeaveTypes: true,
      hasCompensation: true,
    });
    expect(ready.find((r) => r.key === "leave")?.statusLabel).toBe("جاهز");
    expect(ready.find((r) => r.key === "login")?.statusLabel).toBe("جاهز");
  });
});

describe("operational role assignment", () => {
  it("does not treat super_admin or general_manager as HR-assignable", () => {
    expect(isPrivilegedRoleCode("super_admin")).toBe(true);
    expect(isPrivilegedRoleCode("engineer")).toBe(false);
    expect(
      isOperationalAssignableRole({ code: "super_admin", is_external: false, allowPrivileged: false }),
    ).toBe(false);
    expect(
      isOperationalAssignableRole({ code: "engineer", is_external: false, allowPrivileged: false }),
    ).toBe(true);
  });
});
