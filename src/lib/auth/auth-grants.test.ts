import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapUserRoleRowsToGrants } from "@/lib/auth/auth-grants";
import { POST_LOGIN_PATH, safePostLoginPath } from "@/lib/auth/employee-login";
import { homeShowsSelfServiceCard } from "@/lib/home/self-service";
import { BASE_EMPLOYEE_PERMISSIONS, ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";

const ORG = "11111111-1111-1111-1111-111111111111";

describe("post-login destination (digest 744597307)", () => {
  it("falls back to / and only honors a same-origin next path", () => {
    expect(POST_LOGIN_PATH).toBe("/");
    expect(safePostLoginPath(null)).toBe("/");
    expect(safePostLoginPath("https://evil.test/phish")).toBe("/");
    expect(safePostLoginPath("//evil.test")).toBe("/");
    expect(safePostLoginPath("/login")).toBe("/");
    expect(safePostLoginPath("/projects/x?tab=stages")).toBe("/projects/x?tab=stages");
    const action = readFileSync(join(process.cwd(), "src/modules/auth/actions.ts"), "utf8");
    expect(action).toContain("revalidatePath(\"/\", \"layout\")");
    expect(action).toContain("safePostLoginPath");
    expect(action).toContain('formData.get("next")');
    const errorPage = readFileSync(join(process.cwd(), "src/app/error.tsx"), "utf8");
    expect(errorPage).toContain('href="/"');
    expect(errorPage).toContain("الرئيسية");
  });
});

describe("auth grants mapping without throwing", () => {
  it("accepts nested role_permissions arrays for general_manager", () => {
    const grants = mapUserRoleRowsToGrants([
      {
        organization_id: ORG,
        scope_type: "organization",
        scope_id: null,
        roles: {
          code: "general_manager",
          is_external: false,
          role_permissions: [
            { permission_key: "reports.management.read" },
            { permission_key: "job_title.read" },
            { permission_key: "job_title.manage" },
          ],
        },
      },
    ]);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.roleCode).toBe("general_manager");
    expect(grants[0]?.permissions).toEqual([
      "reports.management.read",
      "job_title.read",
      "job_title.manage",
    ]);
  });

  it("treats null or missing nested role_permissions as empty — does not throw", () => {
    expect(() =>
      mapUserRoleRowsToGrants([
        {
          organization_id: ORG,
          scope_type: "organization",
          scope_id: null,
          roles: { code: "general_manager", is_external: false, role_permissions: null },
        },
        {
          organization_id: ORG,
          scope_type: "organization",
          scope_id: null,
          roles: { code: "general_manager", is_external: false },
        },
        {
          organization_id: ORG,
          scope_type: "organization",
          scope_id: null,
          roles: null,
        },
      ]),
    ).not.toThrow();
    const grants = mapUserRoleRowsToGrants([
      {
        organization_id: ORG,
        scope_type: "organization",
        scope_id: null,
        roles: { code: "general_manager", is_external: false, role_permissions: null },
      },
    ]);
    expect(grants[0]?.permissions).toEqual([]);
  });

  it("accepts roles returned as a one-element array (PostgREST shape)", () => {
    const grants = mapUserRoleRowsToGrants([
      {
        organization_id: ORG,
        scope_type: "organization",
        scope_id: null,
        roles: [{ code: "employee", is_external: false, role_permissions: [{ permission_key: "leave.view_self" }] }],
      },
    ]);
    expect(grants[0]?.permissions).toEqual(["leave.view_self"]);
  });
});

describe("Home self-service without employees row", () => {
  it("does not show attendance/leave self cards for GM without an employee row", () => {
    expect(
      homeShowsSelfServiceCard({ hasEmployeeRow: false, permissionGranted: true }),
    ).toBe(false);
    expect(
      homeShowsSelfServiceCard({ hasEmployeeRow: true, permissionGranted: true }),
    ).toBe(true);
    expect(
      homeShowsSelfServiceCard({ hasEmployeeRow: true, permissionGranted: false }),
    ).toBe(false);
  });

  it("does not make employee rows mandatory in getAuthContext", () => {
    const context = readFileSync(join(process.cwd(), "src/server/context.ts"), "utf8");
    expect(context).toContain("employeeResult.data ?? null");
    expect(context).not.toMatch(/if \(!employee\)/);
  });
});

describe("permission freezes", () => {
  it("keeps the certified employee eight and job_title matrix", () => {
    expect(BASE_EMPLOYEE_PERMISSIONS).toHaveLength(8);
    expect(ROLE_PERMISSION_MAP.employee).toEqual(BASE_EMPLOYEE_PERMISSIONS);
    expect(ROLE_PERMISSION_MAP.general_manager).toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.hr_officer).toContain("job_title.read");
    expect(ROLE_PERMISSION_MAP.hr_officer).not.toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("job_title.read");
  });
});
