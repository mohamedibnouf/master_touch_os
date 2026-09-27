import type { EmployeeLoginUiStatus } from "@/lib/auth/employee-login";

export type SetupRowStatus = "complete" | "ready" | "needed";

export type EmployeeSetupRow = {
  key: string;
  label: string;
  status: SetupRowStatus;
  statusLabel: string;
  href: string | null;
};

const STATUS_AR: Record<SetupRowStatus, string> = {
  complete: "مكتمل",
  ready: "جاهز",
  needed: "مطلوب",
};

export function deriveEmployeeSetupRows(input: {
  employeeId: string;
  hasCoreIdentity: boolean;
  loginStatus: EmployeeLoginUiStatus | null;
  hasDepartment: boolean;
  hasRole: boolean;
  hasWorkplaceAssignment: boolean;
  hasShiftAssignment: boolean;
  hasLeaveTypes: boolean;
  hasCompensation: boolean;
}): EmployeeSetupRow[] {
  const loginLabel =
    input.loginStatus === "ready" ? "جاهز" : input.loginStatus === "disabled" ? "موقوف" : "غير مفعّل";
  const loginStatus: SetupRowStatus =
    input.loginStatus === "ready" ? "ready" : input.loginStatus === "disabled" ? "needed" : "needed";

  return [
    {
      key: "core",
      label: "البيانات الأساسية",
      status: input.hasCoreIdentity ? "complete" : "needed",
      statusLabel: input.hasCoreIdentity ? STATUS_AR.complete : STATUS_AR.needed,
      href: null,
    },
    {
      key: "login",
      label: "حساب الدخول",
      status: loginStatus,
      statusLabel: loginLabel,
      href: null,
    },
    {
      key: "department",
      label: "القسم",
      status: input.hasDepartment ? "complete" : "needed",
      statusLabel: input.hasDepartment ? STATUS_AR.complete : STATUS_AR.needed,
      href: `/employees/${input.employeeId}?tab=organization`,
    },
    {
      key: "role",
      label: "الصلاحيات",
      status: input.hasRole ? "complete" : "needed",
      statusLabel: input.hasRole ? STATUS_AR.complete : STATUS_AR.needed,
      href: "/settings",
    },
    {
      key: "workplace",
      label: "موقع الحضور",
      status: input.hasWorkplaceAssignment ? "complete" : "needed",
      statusLabel: input.hasWorkplaceAssignment ? STATUS_AR.complete : STATUS_AR.needed,
      href: "/hr/attendance/locations",
    },
    {
      key: "shift",
      label: "الوردية",
      status: input.hasShiftAssignment ? "complete" : "needed",
      statusLabel: input.hasShiftAssignment ? STATUS_AR.complete : STATUS_AR.needed,
      href: "/hr/attendance/assignments",
    },
    {
      key: "leave",
      label: "الإجازات",
      status: input.hasLeaveTypes && input.hasRole ? "ready" : "needed",
      statusLabel: input.hasLeaveTypes && input.hasRole ? "جاهز" : "يحتاج إعداد",
      href: "/hr/leave/types",
    },
    {
      key: "payroll",
      label: "الرواتب",
      status: input.hasCompensation ? "ready" : "needed",
      statusLabel: input.hasCompensation ? "جاهز" : "يحتاج إعداد",
      href: `/employees/${input.employeeId}?tab=compensation`,
    },
  ];
}
