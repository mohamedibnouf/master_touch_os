import { describe, expect, it } from "vitest";
import {
  APPROVAL_LIST_SELECT,
  APPROVAL_REQUEST_LIST_COLUMNS,
  APPROVAL_STEP_LIST_COLUMNS,
  APPROVAL_STEPS_SCHEMA_COLUMNS,
  ATTENDANCE_RECORD_LIST_COLUMNS,
  AUDIT_FEED_COLUMNS,
  AUTH_EMPLOYEE_COLUMNS,
  AUTH_ORGANIZATION_COLUMNS,
  AUTH_PROFILE_COLUMNS,
  DEPARTMENT_LIST_COLUMNS,
  EMPLOYEE_DIRECTORY_PAGE_COLUMNS,
  EMPLOYEE_DIRECTORY_PROFILE_COLUMNS,
  DOCUMENT_LIST_COLUMNS,
  LEAVE_BALANCE_LIST_COLUMNS,
  LEAVE_REQUEST_LIST_COLUMNS,
  NOTIFICATION_HEADER_COLUMNS,
  NOTIFICATION_LIST_COLUMNS,
  PAYROLL_PERIOD_LIST_COLUMNS,
  PROJECT_LIST_COLUMNS,
  PROJECT_MEMBER_COLUMNS,
  PROJECT_PICKER_COLUMNS,
  ROLE_LIST_COLUMNS,
} from "@/lib/query-projections";
import {
  SCHEMA_APPROVAL_ACTIONS,
  SCHEMA_APPROVAL_STEPS,
  SCHEMA_BY_TABLE,
  assertSelectAgainstSchema,
} from "@/lib/query-projections.schema";
import { EMPLOYEE_DETAIL_COLUMNS, EMPLOYEE_DIRECTORY_COLUMNS } from "@/lib/hr/labels";
import { GPS_STAGE_COPY } from "@/modules/attendance/gps-ux";

describe("list/header query projections", () => {
  it("uses explicit columns rather than select *", () => {
    const all = [
      PROJECT_LIST_COLUMNS,
      PROJECT_PICKER_COLUMNS,
      DOCUMENT_LIST_COLUMNS,
      NOTIFICATION_HEADER_COLUMNS,
      PAYROLL_PERIOD_LIST_COLUMNS,
      AUTH_PROFILE_COLUMNS,
      AUTH_EMPLOYEE_COLUMNS,
      ATTENDANCE_RECORD_LIST_COLUMNS,
    ];
    for (const cols of all) {
      expect(cols.includes("*")).toBe(false);
    }
  });

  it("keeps employee selector/auth projections free of compensation and GPS", () => {
    expect(AUTH_EMPLOYEE_COLUMNS).not.toMatch(/salary|iban|bank|latitude|longitude/i);
    expect(ATTENDANCE_RECORD_LIST_COLUMNS).not.toMatch(/latitude|longitude/);
    expect(PROJECT_PICKER_COLUMNS).toContain("project_code");
    expect(PROJECT_PICKER_COLUMNS).not.toMatch(/budget|contract_value/i);
  });
});

describe("GPS pending copy", () => {
  it("exposes locating then verifying stages without implying a punch was created", () => {
    expect(GPS_STAGE_COPY.locating).toContain("تحديد موقعك");
    expect(GPS_STAGE_COPY.verifying).toContain("التحقق من موقع الحضور");
  });
});

const AUTH_MEMBERSHIP_SELECT = `organization_id, status, organizations(${AUTH_ORGANIZATION_COLUMNS})`;
const AUTH_USER_ROLES_SELECT =
  "organization_id, scope_type, scope_id, roles(code, is_external, role_permissions(permission_key))";
const EMPLOYEE_DIRECTORY_LIST_SELECT = EMPLOYEE_DIRECTORY_PAGE_COLUMNS;
const EMPLOYEE_DETAIL_ROW_SELECT = `${EMPLOYEE_DETAIL_COLUMNS}, profiles(id, full_name_ar, full_name_en, phone, locale, is_active, avatar_path, last_seen_at, created_at, updated_at), employee_departments(id, is_primary, department_id, departments(id, code, name_ar, name_en, is_active))`;
const EMPLOYEE_NAME_OPTIONS_SELECT = "id, profile_id, employee_number, profiles(full_name_ar)";
const EMPLOYEE_PROJECTS_SELECT =
  "id, role_label, is_active, assigned_at, unassigned_at, projects(id, project_code, name_ar, name_en, status)";

const PERFORMANCE_PASS_PROJECTIONS: Array<{ name: string; table: string; select: string }> = [
  { name: "AUTH_PROFILE", table: "profiles", select: AUTH_PROFILE_COLUMNS },
  { name: "AUTH_ORGANIZATION", table: "organizations", select: AUTH_ORGANIZATION_COLUMNS },
  { name: "AUTH_EMPLOYEE", table: "employees", select: AUTH_EMPLOYEE_COLUMNS },
  { name: "AUTH_MEMBERSHIP", table: "organization_members", select: AUTH_MEMBERSHIP_SELECT },
  { name: "AUTH_USER_ROLES", table: "user_roles", select: AUTH_USER_ROLES_SELECT },
  { name: "PROJECT_LIST", table: "projects", select: PROJECT_LIST_COLUMNS },
  { name: "PROJECT_PICKER", table: "projects", select: PROJECT_PICKER_COLUMNS },
  { name: "DOCUMENT_LIST", table: "documents", select: DOCUMENT_LIST_COLUMNS },
  { name: "NOTIFICATION_LIST", table: "notifications", select: NOTIFICATION_LIST_COLUMNS },
  { name: "NOTIFICATION_HEADER", table: "notifications", select: NOTIFICATION_HEADER_COLUMNS },
  { name: "DEPARTMENT_LIST", table: "departments", select: DEPARTMENT_LIST_COLUMNS },
  { name: "ROLE_LIST", table: "roles", select: ROLE_LIST_COLUMNS },
  { name: "PAYROLL_PERIOD_LIST", table: "payroll_periods", select: PAYROLL_PERIOD_LIST_COLUMNS },
  { name: "LEAVE_REQUEST_LIST", table: "leave_requests", select: LEAVE_REQUEST_LIST_COLUMNS },
  { name: "LEAVE_BALANCE_LIST", table: "employee_leave_balances", select: LEAVE_BALANCE_LIST_COLUMNS },
  { name: "ATTENDANCE_RECORD_LIST", table: "attendance_records", select: ATTENDANCE_RECORD_LIST_COLUMNS },
  { name: "AUDIT_FEED", table: "audit_logs", select: AUDIT_FEED_COLUMNS },
  { name: "APPROVAL_REQUEST_LIST", table: "approval_requests", select: APPROVAL_REQUEST_LIST_COLUMNS },
  { name: "APPROVAL_STEP_LIST", table: "approval_steps", select: APPROVAL_STEP_LIST_COLUMNS },
  { name: "PROJECT_MEMBER", table: "project_members", select: PROJECT_MEMBER_COLUMNS },
  { name: "APPROVAL_LIST_SELECT", table: "approval_requests", select: APPROVAL_LIST_SELECT },
  { name: "EMPLOYEE_DIRECTORY_COLUMNS", table: "employees", select: EMPLOYEE_DIRECTORY_COLUMNS },
  { name: "EMPLOYEE_DIRECTORY_LIST", table: "employees", select: EMPLOYEE_DIRECTORY_LIST_SELECT },
  { name: "EMPLOYEE_DIRECTORY_PROFILES", table: "profiles", select: EMPLOYEE_DIRECTORY_PROFILE_COLUMNS },
  { name: "EMPLOYEE_DETAIL_ROW", table: "employees", select: EMPLOYEE_DETAIL_ROW_SELECT },
  { name: "EMPLOYEE_NAME_OPTIONS", table: "employees", select: EMPLOYEE_NAME_OPTIONS_SELECT },
  { name: "EMPLOYEE_PROJECTS", table: "project_members", select: EMPLOYEE_PROJECTS_SELECT },
];

describe("performance-pass projections vs migrations 001–064", () => {
  it("keeps the steps schema allowlist aligned with migration 007", () => {
    expect([...APPROVAL_STEPS_SCHEMA_COLUMNS].sort()).toEqual([...SCHEMA_APPROVAL_STEPS].sort());
    expect(SCHEMA_APPROVAL_ACTIONS).toContain("decision");
    expect(SCHEMA_APPROVAL_STEPS).not.toContain("decision");
  });

  it("selects only columns that exist on the root (and nested) tables", () => {
    for (const proj of PERFORMANCE_PASS_PROJECTIONS) {
      expect(() => assertSelectAgainstSchema(proj.table, proj.select), proj.name).not.toThrow();
    }
  });

  it("does not invent FK hints or ambiguous dual-FK embeds on attendance records", () => {
    expect(ATTENDANCE_RECORD_LIST_COLUMNS).not.toMatch(/!inner|workplaces|check_in_workplace_id|check_out_workplace_id/);
    expect(ATTENDANCE_RECORD_LIST_COLUMNS).not.toMatch(/workplace_locations/);
  });

  it("does not allow embedding employees from organization_members (no FK in 003; PGRST200)", () => {
    expect(() =>
      assertSelectAgainstSchema("organization_members", "profile_id, employees(id, job_title_ar)"),
    ).toThrow(/Unknown embed employees/);
  });
});

describe("approvals list projection (digest 2869482926)", () => {
  it("does not select approval_steps.decision — that column exists only on approval_actions in 007", () => {
    expect(APPROVAL_LIST_SELECT.includes("*")).toBe(false);
    expect(APPROVAL_STEP_LIST_COLUMNS.split(",").map((c) => c.trim())).not.toContain("decision");
    expect(APPROVAL_LIST_SELECT).not.toMatch(/decision/);
    expect(APPROVAL_STEPS_SCHEMA_COLUMNS).not.toContain("decision");
  });

  it("embeds only columns that exist on approval_steps in migration 007", () => {
    const embedded = APPROVAL_STEP_LIST_COLUMNS.split(",").map((c) => c.trim());
    for (const col of embedded) {
      expect(APPROVAL_STEPS_SCHEMA_COLUMNS).toContain(col);
    }
  });

  it("treats missing steps as an empty list without throwing", () => {
    const rows: Array<{ approval_steps: Array<{ sequence: number }> | null }> = [
      { approval_steps: null },
      { approval_steps: [] },
    ];
    expect(() => {
      for (const row of rows) {
        [...(row.approval_steps ?? [])].sort((a, b) => a.sequence - b.sequence);
      }
    }).not.toThrow();
  });
});
