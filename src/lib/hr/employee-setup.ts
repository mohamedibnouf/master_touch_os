import type { EmployeeLoginUiStatus } from "@/lib/auth/employee-login";
import type { Locale } from "@/lib/i18n/config";

export type SetupRowStatus = "complete" | "ready" | "needed";

export type EmployeeSetupRow = {
  key: string;
  label: string;
  status: SetupRowStatus;
  statusLabel: string;
  href: string | null;
};

const SETUP_COPY = {
  ar: {
    complete: "مكتمل",
    ready: "جاهز",
    needed: "مطلوب",
    loginDisabled: "موقوف",
    loginOff: "غير مفعّل",
    needsSetup: "يحتاج إعداد",
    core: "البيانات الأساسية",
    login: "حساب الدخول",
    department: "القسم",
    role: "الصلاحيات",
    workplace: "موقع الحضور",
    shift: "الوردية",
    leave: "الإجازات",
    payroll: "الرواتب",
  },
  en: {
    complete: "Complete",
    ready: "Ready",
    needed: "Required",
    loginDisabled: "Disabled",
    loginOff: "Not enabled",
    needsSetup: "Needs setup",
    core: "Basic details",
    login: "Sign-in account",
    department: "Department",
    role: "Permissions",
    workplace: "Attendance location",
    shift: "Shift",
    leave: "Leave",
    payroll: "Payroll",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function deriveEmployeeSetupRows(
  input: {
    employeeId: string;
    hasCoreIdentity: boolean;
    loginStatus: EmployeeLoginUiStatus | null;
    hasDepartment: boolean;
    hasRole: boolean;
    hasWorkplaceAssignment: boolean;
    hasShiftAssignment: boolean;
    hasLeaveTypes: boolean;
    hasCompensation: boolean;
  },
  locale: Locale = "ar",
): EmployeeSetupRow[] {
  const c = SETUP_COPY[locale];
  const loginLabel =
    input.loginStatus === "ready" ? c.ready : input.loginStatus === "disabled" ? c.loginDisabled : c.loginOff;
  const loginStatus: SetupRowStatus =
    input.loginStatus === "ready" ? "ready" : input.loginStatus === "disabled" ? "needed" : "needed";

  return [
    {
      key: "core",
      label: c.core,
      status: input.hasCoreIdentity ? "complete" : "needed",
      statusLabel: input.hasCoreIdentity ? c.complete : c.needed,
      href: null,
    },
    {
      key: "login",
      label: c.login,
      status: loginStatus,
      statusLabel: loginLabel,
      href: null,
    },
    {
      key: "department",
      label: c.department,
      status: input.hasDepartment ? "complete" : "needed",
      statusLabel: input.hasDepartment ? c.complete : c.needed,
      href: `/employees/${input.employeeId}?tab=organization`,
    },
    {
      key: "role",
      label: c.role,
      status: input.hasRole ? "complete" : "needed",
      statusLabel: input.hasRole ? c.complete : c.needed,
      href: "/settings",
    },
    {
      key: "workplace",
      label: c.workplace,
      status: input.hasWorkplaceAssignment ? "complete" : "needed",
      statusLabel: input.hasWorkplaceAssignment ? c.complete : c.needed,
      href: "/hr/attendance/locations",
    },
    {
      key: "shift",
      label: c.shift,
      status: input.hasShiftAssignment ? "complete" : "needed",
      statusLabel: input.hasShiftAssignment ? c.complete : c.needed,
      href: "/hr/attendance/assignments",
    },
    {
      key: "leave",
      label: c.leave,
      status: input.hasLeaveTypes && input.hasRole ? "ready" : "needed",
      statusLabel: input.hasLeaveTypes && input.hasRole ? c.ready : c.needsSetup,
      href: "/hr/leave/types",
    },
    {
      key: "payroll",
      label: c.payroll,
      status: input.hasCompensation ? "ready" : "needed",
      statusLabel: input.hasCompensation ? c.ready : c.needsSetup,
      href: `/employees/${input.employeeId}?tab=compensation`,
    },
  ];
}
