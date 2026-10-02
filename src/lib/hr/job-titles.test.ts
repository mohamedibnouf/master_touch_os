import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSION_MAP, BASE_EMPLOYEE_PERMISSIONS } from "@/lib/permissions/catalog";
import {
  filterSelectableJobTitles,
  isHistoricalCatalogTitle,
  isLegacyJobTitle,
  isJobTitleCompatibleWithDepartment,
  resolveEmploymentJobTitlePatch,
  resolveNewJobTitleAssignment,
  type JobTitleRecord,
} from "@/lib/hr/job-titles";
import { resolveCreateEmployeeRolePlan } from "@/lib/hr/roles";
import { readCreateEmployeeFormData } from "@/lib/hr/create-employee-form";
import { createEmployeeSchema } from "@/modules/users/schemas";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEPT_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const DEPT_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const EIGHT = [
  "attendance.view_self",
  "attendance.check_in",
  "attendance.check_out",
  "leave.view_self",
  "leave.request",
  "leave.cancel_self",
  "notification.read",
  "payroll.view_self",
] as const;

function title(partial: Partial<JobTitleRecord> & Pick<JobTitleRecord, "id" | "department_id">): JobTitleRecord {
  return {
    organization_id: ORG_A,
    code: null,
    name_ar: "فني كهرباء",
    name_en: "Electrician",
    is_active: true,
    sort_order: 0,
    ...partial,
  };
}

describe("job title catalog domain", () => {
  const orgWide = title({ id: "11111111-1111-4111-8111-111111111111", department_id: null });
  const deptA = title({ id: "22222222-2222-4222-8222-222222222222", department_id: DEPT_A, name_ar: "فني صيانة" });
  const deptB = title({ id: "33333333-3333-4333-8333-333333333333", department_id: DEPT_B, name_ar: "مشرف موقع" });
  const inactive = title({
    id: "44444444-4444-4444-8444-444444444444",
    department_id: null,
    is_active: false,
    name_ar: "مسمى موقوف",
  });
  const otherOrg = title({
    id: "55555555-5555-4555-8555-555555555555",
    department_id: null,
    organization_id: ORG_B,
  });

  it("org-wide titles are compatible with any or no department", () => {
    expect(isJobTitleCompatibleWithDepartment(orgWide, undefined)).toBe(true);
    expect(isJobTitleCompatibleWithDepartment(orgWide, DEPT_A)).toBe(true);
  });

  it("department titles are only compatible with that department", () => {
    expect(isJobTitleCompatibleWithDepartment(deptA, DEPT_A)).toBe(true);
    expect(isJobTitleCompatibleWithDepartment(deptA, DEPT_B)).toBe(false);
    expect(isJobTitleCompatibleWithDepartment(deptA, undefined)).toBe(false);
  });

  it("dropdown: no department → org-wide active only", () => {
    const shown = filterSelectableJobTitles([orgWide, deptA, deptB, inactive], undefined);
    expect(shown.map((t) => t.id)).toEqual([orgWide.id]);
  });

  it("dropdown: department A → org-wide + A, not B, not inactive", () => {
    const shown = filterSelectableJobTitles([orgWide, deptA, deptB, inactive], DEPT_A);
    expect(shown.map((t) => t.id).sort()).toEqual([orgWide.id, deptA.id].sort());
  });

  it("dropdown: department B → org-wide + B", () => {
    const shown = filterSelectableJobTitles([orgWide, deptA, deptB], DEPT_B);
    expect(shown.map((t) => t.id).sort()).toEqual([orgWide.id, deptB.id].sort());
  });

  it("rejects missing, cross-org, inactive, and other-department on new assignment", () => {
    const missing = resolveNewJobTitleAssignment({ title: null, organizationId: ORG_A, departmentId: DEPT_A });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe("missing");
    const cross = resolveNewJobTitleAssignment({ title: otherOrg, organizationId: ORG_A, departmentId: undefined });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.reason).toBe("cross_org");
    const frozen = resolveNewJobTitleAssignment({ title: inactive, organizationId: ORG_A, departmentId: undefined });
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(frozen.reason).toBe("inactive");
    const wrong = resolveNewJobTitleAssignment({ title: deptB, organizationId: ORG_A, departmentId: DEPT_A });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) return;
    expect(wrong.reason).toBe("wrong_department");
  });

  it("accepts active org-wide and matching department titles", () => {
    expect(resolveNewJobTitleAssignment({ title: orgWide, organizationId: ORG_A, departmentId: DEPT_A }).ok).toBe(true);
    expect(resolveNewJobTitleAssignment({ title: deptA, organizationId: ORG_A, departmentId: DEPT_A }).ok).toBe(true);
  });

  it("copies snapshot names from the catalog record, not client strings", () => {
    const result = resolveNewJobTitleAssignment({ title: deptA, organizationId: ORG_A, departmentId: DEPT_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobTitleAr).toBe("فني صيانة");
    expect(result.jobTitleEn).toBe("Electrician");
    expect(result.jobTitleId).toBe(deptA.id);
  });

  it("keeps current inactive/incompatible title; new assignment still validates", () => {
    const keep = resolveEmploymentJobTitlePatch({
      submittedTitleId: inactive.id,
      currentTitleId: inactive.id,
      title: inactive,
      organizationId: ORG_A,
      departmentId: DEPT_A,
    });
    expect(keep).toEqual({ ok: true, keep: true });

    const switched = resolveEmploymentJobTitlePatch({
      submittedTitleId: deptB.id,
      currentTitleId: inactive.id,
      title: deptB,
      organizationId: ORG_A,
      departmentId: DEPT_A,
    });
    expect(switched.ok).toBe(false);
  });

  it("legacy employee without job_title_id remains valid", () => {
    expect(isLegacyJobTitle({ jobTitleId: null, jobTitleAr: "فني تكييف" })).toBe(true);
    expect(isLegacyJobTitle({ jobTitleId: orgWide.id, jobTitleAr: "فني تكييف" })).toBe(false);
  });

  it("marks inactive or wrong-department catalog titles as historical", () => {
    expect(isHistoricalCatalogTitle({ title: inactive, departmentId: DEPT_A })).toBe(true);
    expect(isHistoricalCatalogTitle({ title: deptB, departmentId: DEPT_A })).toBe(true);
    expect(isHistoricalCatalogTitle({ title: orgWide, departmentId: DEPT_A })).toBe(false);
  });

  it("legacy create still accepts job_title_ar without job_title_id", () => {
    const fd = new FormData();
    fd.set("employee_number", "E-1");
    fd.set("full_name_ar", "سارة أحمد");
    fd.set("full_name_en", "Sara Ahmed");
    fd.set("job_title_ar", "عامل صيانة");
    const parsed = createEmployeeSchema.safeParse(readCreateEmployeeFormData(fd));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.job_title_id).toBeUndefined();
    expect(parsed.data.job_title_ar).toBe("عامل صيانة");
  });

  it("title selection does not bypass role assignment rules", () => {
    expect(
      resolveCreateEmployeeRolePlan({
        selectedRoleId: "20000000-0000-0000-0000-000000000007",
        loginProvisioned: true,
      }).mode,
    ).toBe("selected");
    expect(resolveCreateEmployeeRolePlan({ selectedRoleId: undefined, loginProvisioned: true }).mode).toBe(
      "default_employee",
    );
  });

  it("base employee permissions stay eight keys and exclude job_title.manage/read", () => {
    expect([...ROLE_PERMISSION_MAP.employee].sort()).toEqual([...EIGHT].sort());
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("job_title.read");
    expect([...BASE_EMPLOYEE_PERMISSIONS]).toHaveLength(8);
  });

  it("job_title.manage is granted to hr_manager, not employee", () => {
    expect(ROLE_PERMISSION_MAP.hr_manager).toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.hr_manager).toContain("job_title.read");
    expect(ROLE_PERMISSION_MAP.hr_officer).toContain("job_title.read");
    expect(ROLE_PERMISSION_MAP.hr_officer).not.toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.super_admin).toContain("job_title.manage");
    expect(ROLE_PERMISSION_MAP.general_manager).toContain("job_title.manage");
  });
});

describe("migration 068 safety", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/068_job_titles.sql"), "utf8");
  const sql067 = readFileSync(join(process.cwd(), "supabase/migrations/067_base_employee_role.sql"), "utf8");

  it("is additive: table, nullable FK, permissions, RLS, no destructive employee rewrite", () => {
    expect(sql).toContain("create table public.job_titles");
    expect(sql).toContain("add column if not exists job_title_id");
    expect(sql).toContain("on delete restrict");
    expect(sql).toContain("job_title.read");
    expect(sql).toContain("job_title.manage");
    expect(sql).toContain("JOB_TITLE_DEPARTMENT_ORG_MISMATCH");
    expect(sql).toContain("JOB_TITLE_CREATED_BY_ORG_MISMATCH");
    expect(sql).toContain("job_titles_org_wide_name_ar_uidx");
    expect(sql).toContain("job_titles_dept_name_ar_uidx");
    expect(sql).not.toMatch(/drop table|truncate|delete from public\.employees|update public\.employees/i);
    expect(sql).not.toMatch(/insert into public\.user_roles/i);
    expect(sql).not.toMatch(/create policy job_titles_delete/i);
    expect(sql).not.toContain("role.manage");
    expect(sql).toContain("raise exception 'JOB_TITLE_DEPARTMENT_ORG_MISMATCH' using errcode = 'P0001';");
    expect(sql).toContain("raise exception 'JOB_TITLE_CREATED_BY_ORG_MISMATCH' using errcode = 'P0001';");
    expect(sql).not.toMatch(/raise exception '[^']+'[\s\S]{0,40}message\s*=/i);
  });

  it("does not alter certified employee role grants in 067", () => {
    expect(sql067).not.toContain("job_title");
    for (const key of EIGHT) {
      expect(sql067).toContain(`'${key}'`);
    }
  });

  it("does not grant job_title.manage to the employee role", () => {
    expect(sql).not.toMatch(/r\.code = 'employee'/);
  });
});

describe("job title UI copy", () => {
  const createUi = readFileSync(join(process.cwd(), "src/components/hr/employee-create-form.tsx"), "utf8");
  const titleFields = readFileSync(join(process.cwd(), "src/components/hr/employee-title-fields.tsx"), "utf8");

  it("orders الإدارة then المسمى الوظيفي then صلاحية النظام", () => {
    expect(createUi).toContain("الإدارة ثم المسمى الوظيفي ثم صلاحية النظام");
    expect(titleFields).toContain('label="الإدارة"');
    expect(titleFields).toContain('label="المسمى الوظيفي"');
    expect(createUi).toContain("صلاحية النظام");
    expect(createUi).not.toContain('name="job_title_ar"');
  });

  it("shows empty-state copy and management link", () => {
    expect(titleFields).toContain("لا توجد مسميات وظيفية نشطة لهذه الإدارة.");
    expect(titleFields).toContain("/departments/job-titles");
  });
});
