import Link from "next/link";
import { redirect } from "next/navigation";
import { Timer, UserCheck, Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deriveEmployeeDirectoryStats } from "@/lib/hr/directory-page";
import { traceEmployeesPageOp } from "@/lib/hr/employees-page-trace";
import { JobTitleRepository } from "@/server/repositories/job-title.repository";
import { EmployeeCreateForm } from "@/components/hr/employee-create-form";
import { EmployeeDirectory } from "@/components/hr/employee-directory";

type RoleRow = { id: string; name_ar: string; code?: string; is_external?: boolean };

export default async function EmployeesPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canHrDirectory =
    hasPermission(ctx, "employee.read") ||
    hasPermission(ctx, "employee.manage") ||
    hasPermission(ctx, "employee.create");
  const canDeptManagerDirectory = hasPermission(ctx, "department.update");
  if (!canHrDirectory && !canDeptManagerDirectory) {
    if (ctx.employee?.id) redirect(`/employees/${ctx.employee.id}`);
    redirect("/");
  }

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const canCreate = hasPermission(ctx, "employee.create") || hasPermission(ctx, "user.create");
  const employees = await traceEmployeesPageOp("listEmployees", () =>
    repo.listEmployees(ctx.organization.id),
  );
  const [departments, roles, titles] = await Promise.all([
    traceEmployeesPageOp("listDepartments", () => repo.listDepartments(ctx.organization.id)),
    canHrDirectory
      ? traceEmployeesPageOp("listRoles", () => repo.listRoles())
      : Promise.resolve([]),
    canCreate
      ? new JobTitleRepository(supabase).listByOrganization(ctx.organization.id, { activeOnly: true })
      : Promise.resolve([]),
  ]);
  const stats = deriveEmployeeDirectoryStats(employees);

  const roleRows = roles as RoleRow[];
  const canAssignRole = hasPermission(ctx, "role.assign");
  const allowPrivilegedRoles = ctx.profile.is_platform_admin;
  const canManageTitles = hasPermission(ctx, "job_title.manage");

  return (
    <PageContainer data-testid="employees-page" className="space-y-5">
      <PageHeader
        title="الموظفون"
        description="إدارة ملفات الموظفين وبياناتهم الوظيفية — بدون رواتب أو بيانات بنكية في الدليل العام"
        actions={
          canCreate ? (
            <Link
              href="#employee-create-card"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-navy px-4 text-sm font-medium text-white shadow-[var(--shadow-1)] duration-150 hover:bg-navy-deep md:min-h-10"
            >
              إضافة موظف
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3" data-testid="employees-stats">
        <div className="mt-metric mt-tint-navy">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <Users className="h-3.5 w-3.5 text-navy" aria-hidden />
            إجمالي السجلات
          </span>
          <span className="mt-1.5 block text-xl font-semibold tabular-nums text-navy">{stats.total}</span>
        </div>
        <div className="mt-metric mt-tint-success">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <UserCheck className="h-3.5 w-3.5 text-navy" aria-hidden />
            نشطون
          </span>
          <span className="mt-1.5 block text-xl font-semibold tabular-nums text-navy">{stats.active}</span>
        </div>
        <div className="mt-metric mt-tint-info col-span-2 md:col-span-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <Timer className="h-3.5 w-3.5 text-navy" aria-hidden />
            تحت التجربة
          </span>
          <span className="mt-1.5 block text-xl font-semibold tabular-nums text-navy">{stats.probation}</span>
        </div>
      </div>

      {canCreate ? (
        <EmployeeCreateForm
          departments={departments}
          titles={titles}
          roles={roleRows}
          canAssignRole={canAssignRole}
          allowPrivilegedRoles={allowPrivilegedRoles}
          canManageTitles={canManageTitles}
        />
      ) : null}

      {employees.length === 0 ? (
        <div id="employees-list">
          <EmptyState
            title="لا يوجد موظفون بعد."
            description="عند إنشاء أول موظف سيظهر في هذا الدليل."
            action={
              canCreate ? (
                <Link
                  href="#employee-create-card"
                  className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-navy px-4 text-sm font-medium text-white"
                >
                  إضافة موظف
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <div id="employees-list">
          <h2 className="mt-section-title mb-2">دليل الموظفين</h2>
          <EmployeeDirectory employees={employees} />
        </div>
      )}
    </PageContainer>
  );
}
