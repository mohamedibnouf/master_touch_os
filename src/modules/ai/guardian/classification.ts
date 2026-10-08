import type { ManagementRiskCategory } from "@/modules/management/types";

export type GuardianSensitivityClass = "payroll" | "hr" | "operations";

export const PAYROLL_FINDING_PERMISSIONS = [
  "payroll.view_all",
  "payroll.review",
  "payroll.approve",
  "payroll.prepare",
] as const;

export const HR_FINDING_PERMISSIONS = [
  "employee.manage",
  "employee_compliance.read",
  "employee_contract.read",
  "attendance.view_all",
  "attendance.manage",
  "leave.view_all",
  "leave.manage",
] as const;

export const MANAGEMENT_VIEW_PERMISSIONS = ["reports.management.read", "ai.management.view"] as const;

export function findingSensitivityClass(
  category: ManagementRiskCategory | string,
): GuardianSensitivityClass {
  if (category === "PAYROLL") return "payroll";
  if (category === "HR" || category === "ATTENDANCE" || category === "LEAVE" || category === "COMPLIANCE") {
    return "hr";
  }
  return "operations";
}

/** Mirrors public.can_read_ai_finding — management view is never enough for HR/payroll rows. */
export function canReadAiFinding(input: {
  category: ManagementRiskCategory | string;
  hasManagementView: boolean;
  hasPayrollAuthorization: boolean;
  hasHrAuthorization: boolean;
}): boolean {
  if (!input.hasManagementView) return false;
  const cls = findingSensitivityClass(input.category);
  if (cls === "payroll") return input.hasPayrollAuthorization;
  if (cls === "hr") return input.hasHrAuthorization;
  return cls === "operations";
}

export function mayEmailFindingClass(category: ManagementRiskCategory | string): boolean {
  return findingSensitivityClass(category) === "operations";
}
