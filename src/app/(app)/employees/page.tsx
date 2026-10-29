import Link from "next/link";
import { redirect } from "next/navigation";
import { Timer, UserCheck, UserPlus, Users } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
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
import { getI18n } from "@/lib/i18n/server";

type RoleRow = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  code?: string;
  is_external?: boolean;
  is_system?: boolean;
  is_active?: boolean;
};

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

  const { t } = await getI18n();
  const te = t.hrPeople.employees;

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const canCreate = hasPermission(ctx, "employee.create") || hasPermission(ctx, "user.create");
  const employees = await traceEmployeesPageOp("listEmployees", () =>
    repo.listEmployees(ctx.organization.id),
  );
  const [departments, roles, titles] = await Promise.all([
    traceEmployeesPageOp("listDepartments", () => repo.listDepartments(ctx.organization.id)),
    canHrDirectory
      ? traceEmployeesPageOp("listRoles", () => repo.listRoles(ctx.organization.id))
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

  const addEmployeeLink = (
    <Link
      href="#employee-create-card"
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-white shadow-[var(--shadow-1)] duration-150 hover:bg-primary-hover md:min-h-10"
    >
      <UserPlus className="size-4" aria-hidden />
      {te.addEmployee}
    </Link>
  );

  return (
    <PageContainer data-testid="employees-page" className="space-y-5">
      <PageHeader title={te.title} description={te.description} actions={canCreate ? addEmployeeLink : null} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="employees-stats">
        <StatCard label={te.statTotal} value={stats.total} icon={<Users className="size-5" />} tone="info" />
        <StatCard label={te.statActive} value={stats.active} icon={<UserCheck className="size-5" />} tone="success" />
        <div className="col-span-2 md:col-span-1">
          <StatCard label={te.statProbation} value={stats.probation} icon={<Timer className="size-5" />} tone="warning" />
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
            title={te.emptyTitle}
            description={te.emptyDescription}
            action={canCreate ? addEmployeeLink : null}
          />
        </div>
      ) : (
        <div id="employees-list">
          <h2 className="mt-section-title mb-2">{te.directoryHeading}</h2>
          <EmployeeDirectory employees={employees} />
        </div>
      )}
    </PageContainer>
  );
}
