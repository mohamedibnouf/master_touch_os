import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_EMPLOYEE_PERMISSIONS,
  ROLE_PERMISSION_MAP,
  SYSTEM_ROLES,
  type PermissionKey,
  type SystemRoleCode,
} from "@/lib/permissions/catalog";
import { evaluatePermission, type RoleGrant } from "@/lib/permissions/evaluate";
import {
  BASE_EMPLOYEE_ROLE_CODE,
  isOperationalAssignableRole,
  isTrustedBaseEmployeeRole,
  resolveCreateEmployeeRolePlan,
} from "@/lib/hr/roles";
import { createEmployeeSchema } from "@/modules/users/schemas";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "20000000-0000-0000-0000-000000000018";
const ENGINEER_ID = "20000000-0000-0000-0000-000000000007";

const EIGHT: PermissionKey[] = [
  "attendance.view_self",
  "attendance.check_in",
  "attendance.check_out",
  "leave.view_self",
  "leave.request",
  "leave.cancel_self",
  "notification.read",
  "payroll.view_self",
];

function grant(role: SystemRoleCode, organizationId: string): RoleGrant {
  return {
    roleCode: role,
    isExternal: role === "client" || role === "consultant" || role === "supplier" || role === "subcontractor",
    organizationId,
    scopeType: "organization",
    scopeId: null,
    permissions: ROLE_PERMISSION_MAP[role],
  };
}

describe("base employee system role", () => {
  it("A. employee exists in SYSTEM_ROLES", () => {
    expect(SYSTEM_ROLES).toContain("employee");
    expect(BASE_EMPLOYEE_ROLE_CODE).toBe("employee");
  });

  it("B. ROLE_PERMISSION_MAP.employee contains EXACTLY eight permissions", () => {
    expect([...ROLE_PERMISSION_MAP.employee].sort()).toEqual([...EIGHT].sort());
    expect(ROLE_PERMISSION_MAP.employee).toHaveLength(8);
    expect([...BASE_EMPLOYEE_PERMISSIONS].sort()).toEqual([...EIGHT].sort());
  });

  it("C–J. employee has the eight self-service keys", () => {
    for (const key of EIGHT) {
      expect(ROLE_PERMISSION_MAP.employee).toContain(key);
      expect(evaluatePermission([grant("employee", ORG_A)], key, { organizationId: ORG_A })).toBe(true);
    }
  });

  it("K–Q. employee is denied management and archive keys", () => {
    const denied = [
      "employee.manage",
      "employee.read",
      "employee.create",
      "employee.read_sensitive",
      "attendance.view_team",
      "attendance.view_all",
      "attendance.manage",
      "attendance.adjust",
      "leave.approve_manager",
      "leave.view_team",
      "leave.view_all",
      "leave.manage",
      "leave.adjust_balance",
      "payroll.view_all",
      "document.archive",
      "document.upload",
      "settings.manage",
      "role.assign",
      "reports.management.read",
    ] as const;
    for (const key of denied) {
      expect(ROLE_PERMISSION_MAP.employee).not.toContain(key);
      expect(evaluatePermission([grant("employee", ORG_A)], key, { organizationId: ORG_A })).toBe(false);
    }
  });

  it("R. employee is operationally assignable", () => {
    expect(
      isOperationalAssignableRole({ code: "employee", is_external: false, allowPrivileged: false }),
    ).toBe(true);
  });

  it("S. external roles remain unassignable", () => {
    for (const code of ["client", "consultant", "supplier", "subcontractor"] as const) {
      expect(isOperationalAssignableRole({ code, is_external: true, allowPrivileged: false })).toBe(false);
    }
  });

  it("T. privileged roles remain protected", () => {
    expect(
      isOperationalAssignableRole({ code: "super_admin", is_external: false, allowPrivileged: false }),
    ).toBe(false);
    expect(
      isOperationalAssignableRole({ code: "general_manager", is_external: false, allowPrivileged: false }),
    ).toBe(false);
    expect(
      isOperationalAssignableRole({ code: "super_admin", is_external: false, allowPrivileged: true }),
    ).toBe(true);
  });

  it("U. create with password + no role defaults server-side to employee", () => {
    expect(resolveCreateEmployeeRolePlan({ selectedRoleId: undefined, loginProvisioned: true })).toEqual({
      mode: "default_employee",
    });
  });

  it("V. create with password + explicit engineer keeps engineer", () => {
    expect(
      resolveCreateEmployeeRolePlan({ selectedRoleId: ENGINEER_ID, loginProvisioned: true }),
    ).toEqual({ mode: "selected", roleId: ENGINEER_ID });
  });

  it("W. create without password + no role creates no user_roles assignment", () => {
    expect(resolveCreateEmployeeRolePlan({ selectedRoleId: undefined, loginProvisioned: false })).toEqual({
      mode: "none",
    });
  });

  it("no password + explicit role preserves selected assignment", () => {
    expect(
      resolveCreateEmployeeRolePlan({ selectedRoleId: ENGINEER_ID, loginProvisioned: false }),
    ).toEqual({ mode: "selected", roleId: ENGINEER_ID });
  });

  it("does not trust a client-supplied role code for the default", () => {
    expect(resolveCreateEmployeeRolePlan({ selectedRoleId: undefined, loginProvisioned: true }).mode).not.toBe(
      "selected",
    );
    expect(isTrustedBaseEmployeeRole({ id: EMPLOYEE_ID, code: "engineer", is_external: false })).toBe(false);
    expect(isTrustedBaseEmployeeRole({ id: EMPLOYEE_ID, code: "employee", is_external: true })).toBe(false);
    expect(isTrustedBaseEmployeeRole({ id: EMPLOYEE_ID, code: "employee", is_external: false })).toBe(true);
  });

  it("X. employee self attendance authorization succeeds", () => {
    const grants = [grant("employee", ORG_A)];
    expect(evaluatePermission(grants, "attendance.view_self", { organizationId: ORG_A })).toBe(true);
    expect(evaluatePermission(grants, "attendance.check_in", { organizationId: ORG_A })).toBe(true);
    expect(evaluatePermission(grants, "attendance.check_out", { organizationId: ORG_A })).toBe(true);
  });

  it("Y. employee team attendance authorization fails", () => {
    expect(evaluatePermission([grant("employee", ORG_A)], "attendance.view_team", { organizationId: ORG_A })).toBe(
      false,
    );
  });

  it("Z. employee self leave authorization succeeds", () => {
    const grants = [grant("employee", ORG_A)];
    expect(evaluatePermission(grants, "leave.view_self", { organizationId: ORG_A })).toBe(true);
    expect(evaluatePermission(grants, "leave.request", { organizationId: ORG_A })).toBe(true);
    expect(evaluatePermission(grants, "leave.cancel_self", { organizationId: ORG_A })).toBe(true);
  });

  it("AA. employee leave approval authorization fails", () => {
    expect(evaluatePermission([grant("employee", ORG_A)], "leave.approve_manager", { organizationId: ORG_A })).toBe(
      false,
    );
  });

  it("AB. employee own payslip access model remains self-scoped in catalog", () => {
    expect(ROLE_PERMISSION_MAP.employee).toContain("payroll.view_self");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("payroll.view_all");
  });

  it("AC/AD. cross-employee and cross-org grants cannot use another org", () => {
    expect(evaluatePermission([grant("employee", ORG_A)], "leave.view_self", { organizationId: ORG_B })).toBe(false);
    expect(evaluatePermission([grant("employee", ORG_A)], "payroll.view_self", { organizationId: ORG_B })).toBe(false);
    expect(evaluatePermission([grant("employee", ORG_A)], "attendance.view_self", { organizationId: ORG_B })).toBe(
      false,
    );
  });

  it("AE. document archive remains denied", () => {
    expect(evaluatePermission([grant("employee", ORG_A)], "document.archive", { organizationId: ORG_A })).toBe(false);
  });

  it("AF. job title remains independent free text", () => {
    const parsed = createEmployeeSchema.safeParse({
      employee_number: "E-9",
      full_name_ar: "عامل موقع",
      full_name_en: "Site Worker",
      job_title_ar: "فني تكييف",
      initial_password: "Passw0rd!",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.job_title_ar).toBe("فني تكييف");
    expect(parsed.data.role_id).toBeUndefined();
    expect(resolveCreateEmployeeRolePlan({ selectedRoleId: parsed.data.role_id, loginProvisioned: true }).mode).toBe(
      "default_employee",
    );
  });
});

describe("067 base employee role SQL and create UX copy", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/067_base_employee_role.sql"), "utf8");
  const createUi = readFileSync(
    join(process.cwd(), "src/components/hr/employee-create-form.tsx"),
    "utf8",
  );
  const payslipRls = readFileSync(
    join(process.cwd(), "supabase/migrations/060_phase4_payroll_payslip_rls_repair.sql"),
    "utf8",
  );

  it("AG. role label/helper copy is correct", () => {
    expect(createUi).toContain("صلاحية النظام");
    expect(createUi).toContain("تحدد ما يستطيع الموظف الوصول إليه داخل النظام، ولا تمثل مسماه الوظيفي.");
    expect(createUi).toContain("مثال: عامل، فني كهرباء، مشرف موقع");
    expect(createUi).toContain('name="job_title_ar"');
    expect(createUi).not.toMatch(/<Field label="الدور">/);
  });

  it("067 is additive, grants eight keys, and does not backfill user_roles", () => {
    expect(sql).toContain("'employee'");
    expect(sql).toContain(EMPLOYEE_ID);
    expect(sql).toContain("موظف");
    expect(sql).toContain("Employee");
    for (const key of EIGHT) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).not.toMatch(/insert into public\.user_roles/i);
    expect(sql).not.toMatch(/delete from|truncate|drop table|update public\.roles/i);
    expect(sql).not.toContain("viewer");
    expect(sql).not.toContain("engineer");
    expect(sql).not.toContain("worker");
    expect(sql).not.toContain("technician");
    expect(sql).not.toContain("supervisor");
  });

  it("AB. existing payslip self RLS still requires own profile and locked/paid", () => {
    expect(payslipRls).toContain("payroll.view_self");
    expect(payslipRls).toContain("e.profile_id = auth.uid()");
    expect(payslipRls).toContain("locked");
    expect(payslipRls).toContain("paid");
  });
});
