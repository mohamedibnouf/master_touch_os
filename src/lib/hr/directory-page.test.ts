import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPLOYMENT_TYPE_LABELS, employmentTypeLabel } from "@/lib/hr/labels";
import { EMPLOYEE_DIRECTORY_PAGE_COLUMNS } from "@/lib/query-projections";
import {
  attachProfilesById,
  deriveEmployeeDirectoryStats,
  directoryProfileName,
} from "./directory-page";

describe("GET /employees directory page (digest 1887336570)", () => {
  it("does not launch extra employees count scans or nested profile embeds from the page", () => {
    const page = readFileSync("src/app/(app)/employees/page.tsx", "utf8");
    expect(page).not.toContain("employeeDirectoryStats");
    expect(page).toContain("deriveEmployeeDirectoryStats");
    expect(page).toContain("traceEmployeesPageOp");
    expect(page).not.toContain("organization_members");
    expect(page).not.toMatch(/employees\(/);
    expect(page).not.toMatch(/profiles\(/);
    expect(page).not.toMatch(/employee_departments\(/);

    const repo = readFileSync("src/server/repositories/core.repository.ts", "utf8");
    const listFn = repo.slice(repo.indexOf("async listEmployees"), repo.indexOf("async listEmployeeNameOptions"));
    expect(listFn).toContain("EMPLOYEE_DIRECTORY_PAGE_COLUMNS");
    expect(listFn).not.toMatch(/profiles\(/);
    expect(listFn).toContain('.from("profiles")');
  });

  it("derives stats from listed rows (empty, inactive, probation) without a second employees scan", () => {
    expect(deriveEmployeeDirectoryStats([])).toEqual({ total: 0, active: 0, probation: 0 });
    expect(
      deriveEmployeeDirectoryStats([
        { is_active: true, employment_status: "active" },
        { is_active: false, employment_status: "terminated" },
        { is_active: true, employment_status: "probation" },
      ]),
    ).toEqual({ total: 3, active: 2, probation: 1 });
  });

  it("renders optional/null profile shapes without throwing", () => {
    expect(directoryProfileName(null)).toBe("بدون اسم");
    expect(directoryProfileName(undefined)).toBe("بدون اسم");
    expect(directoryProfileName({ full_name_ar: null })).toBe("بدون اسم");
    expect(directoryProfileName({ full_name_ar: "  " })).toBe("بدون اسم");
    expect(directoryProfileName({ full_name_ar: "سارة" })).toBe("سارة");
    expect(directoryProfileName([{ full_name_ar: "من المصفوفة" }])).toBe("من المصفوفة");
  });

  it("does not crash on unknown employment_type (broken page used EMPLOYMENT_TYPE_LABELS[empType].ar)", () => {
    expect(() => (EMPLOYMENT_TYPE_LABELS as Record<string, { ar: string }>)["contractor"].ar).toThrow();
    expect(employmentTypeLabel("contractor")).toBe("—");
    expect(employmentTypeLabel(null)).toBe("—");
    expect(employmentTypeLabel("permanent")).toContain("دائم");
  });

  it("attaches missing profiles as null for inactive employees without related rows", () => {
    const rows = attachProfilesById(
      [
        { id: "e1", profile_id: "p1", is_active: false },
        { id: "e2", profile_id: "p-missing", is_active: true },
      ],
      [{ id: "p1", full_name_ar: "أحمد" }],
    );
    expect(rows[0]?.profiles?.full_name_ar).toBe("أحمد");
    expect(rows[1]?.profiles).toBeNull();
  });

  it("keeps the page projection free of nested relationships and compensation fields", () => {
    expect(EMPLOYEE_DIRECTORY_PAGE_COLUMNS.includes("*")).toBe(false);
    expect(EMPLOYEE_DIRECTORY_PAGE_COLUMNS).not.toMatch(/profiles|organization_members|employee_departments|departments/);
    expect(EMPLOYEE_DIRECTORY_PAGE_COLUMNS).not.toMatch(/salary|iban|bank|iqama|passport/i);
  });
});
