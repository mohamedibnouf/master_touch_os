import type { AuthContext } from "@/types/models";
import { can } from "@/lib/permissions/evaluate";
import { AppShellFrame } from "./app-shell-frame";

export async function AppShell({
  ctx,
  children,
}: {
  ctx: AuthContext;
  children: React.ReactNode;
}) {
  const orgCtx = { organizationId: ctx.organization.id };
  // HR directory + department-manager operational scope (RLS-scoped; no employee.read).
  // Do not show for plain employees/engineers who only have a self employee row.
  const canEmployees =
    can(ctx.grants, "employee.read", orgCtx) ||
    can(ctx.grants, "employee.manage", orgCtx) ||
    can(ctx.grants, "employee.create", orgCtx) ||
    can(ctx.grants, "department.update", orgCtx);
  const canDepartments = can(ctx.grants, "department.read", orgCtx);
  const canLeave =
    can(ctx.grants, "leave.view_self", orgCtx) ||
    can(ctx.grants, "leave.request", orgCtx) ||
    can(ctx.grants, "leave.view_team", orgCtx) ||
    can(ctx.grants, "leave.view_all", orgCtx) ||
    can(ctx.grants, "leave.manage", orgCtx);
  const canAttendance =
    can(ctx.grants, "attendance.view_self", orgCtx) ||
    can(ctx.grants, "attendance.check_in", orgCtx) ||
    can(ctx.grants, "attendance.view_team", orgCtx) ||
    can(ctx.grants, "attendance.view_all", orgCtx) ||
    can(ctx.grants, "attendance.manage", orgCtx);
  const canPayroll =
    can(ctx.grants, "payroll.view_self", orgCtx) ||
    can(ctx.grants, "payroll.view_all", orgCtx) ||
    can(ctx.grants, "payroll.prepare", orgCtx) ||
    can(ctx.grants, "payroll.review", orgCtx) ||
    can(ctx.grants, "payroll.approve", orgCtx) ||
    can(ctx.grants, "payroll.record_payment", orgCtx) ||
    can(ctx.grants, "payroll.calculate", orgCtx) ||
    can(ctx.grants, "payroll.adjust", orgCtx) ||
    can(ctx.grants, "payroll.manage_settings", orgCtx);

  return (
    <AppShellFrame
      organizationNameAr={ctx.organization.name_ar}
      organizationNameEn={ctx.organization.name_en}
      userName={ctx.profile.full_name_ar || ctx.profile.full_name_en || "مستخدم"}
      jobTitle={ctx.employee?.job_title_ar ?? "حساب تشغيلي"}
      canEmployees={canEmployees}
      canDepartments={canDepartments}
      canLeave={canLeave}
      canAttendance={canAttendance}
      canPayroll={canPayroll}
    >
      {children}
    </AppShellFrame>
  );
}
