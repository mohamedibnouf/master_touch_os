import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { createEmployeeAction } from "@/server/use-cases/hr";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES } from "@/lib/hr/labels";
import type { EmploymentStatus, EmploymentType } from "@/types/enums";

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
  const [employees, departments, roles] = await Promise.all([
    repo.listEmployees(ctx.organization.id),
    repo.listDepartments(ctx.organization.id),
    canHrDirectory ? repo.listRoles() : Promise.resolve([]),
  ]);

  const stats = canHrDirectory
    ? await repo.employeeDirectoryStats(ctx.organization.id)
    : {
        total: employees.length,
        active: employees.filter((e) => e.is_active).length,
        probation: employees.filter((e) => e.employment_status === "probation").length,
      };

  const roleRows = roles as RoleRow[];
  const canCreate = hasPermission(ctx, "employee.create") || hasPermission(ctx, "user.create");
  const canAssignRole = hasPermission(ctx, "role.assign");
  const allowPrivilegedRoles = ctx.profile.is_platform_admin;

  return (
    <div data-testid="employees-page">
      <PageHeader
        title="الموظفون"
        description="سجل الموظفين التشغيلي — بدون رواتب أو بيانات بنكية في الدليل العام"
      />

      <div className="mb-6 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3" data-testid="employees-stats">
        <Card>
          <p className="text-sm text-muted">إجمالي السجلات</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{stats.total}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">نشطون</p>
          <p className="mt-1 text-2xl font-semibold text-success">{stats.active}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">تحت التجربة</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{stats.probation}</p>
        </Card>
      </div>

      {canCreate ? (
        <Card className="mb-6" data-testid="employee-create-card">
          <h2 className="mb-4 text-base font-semibold text-navy">توظيف موظف جديد</h2>
          <p className="mb-4 text-sm text-muted">
            يتطلب صلاحية إنشاء موظف. سجّل الدخول للموظف يتم بالرقم الوظيفي وكلمة المرور — ليس بالبريد.
            تعيين الأدوار يتطلب صلاحية منفصلة.
          </p>
          <ServerActionForm action={createEmployeeAction} className="grid gap-3 md:grid-cols-2">
            <Field label="الرقم الوظيفي">
              <Input name="employee_number" required data-testid="employee-create-number" />
            </Field>
            <Field label="كلمة مرور الدخول (اختياري)">
              <Input
                name="initial_password"
                type="password"
                autoComplete="new-password"
                data-testid="employee-create-password"
              />
            </Field>
            <Field label="بريد داخلي اختياري — لا يُطلب من الموظف عند الدخول">
              <Input name="email" type="email" data-testid="employee-create-email" />
            </Field>
            <Field label="الاسم بالعربية">
              <Input name="full_name_ar" required data-testid="employee-create-name-ar" />
            </Field>
            <Field label="الاسم بالإنجليزية">
              <Input name="full_name_en" required data-testid="employee-create-name-en" />
            </Field>
            <Field label="المسمى الوظيفي">
              <Input name="job_title_ar" data-testid="employee-create-title" />
            </Field>
            <Field label="نوع التوظيف">
              <Select name="employment_type" defaultValue="" data-testid="employee-create-type">
                <option value="">غير محدد</option>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYMENT_TYPE_LABELS[t].ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الإدارة">
              <Select name="department_id" defaultValue="" data-testid="employee-create-department">
                <option value="">بدون</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            {canAssignRole ? (
              <Field label="الدور">
                <Select name="role_id" defaultValue="" data-testid="employee-create-role">
                  <option value="">بدون</option>
                  {roleRows
                    .filter((role) =>
                      isOperationalAssignableRole({
                        code: role.code,
                        is_external: role.is_external,
                        allowPrivileged: allowPrivilegedRoles,
                      }),
                    )
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name_ar}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            <Field label="الجنسية">
              <Input name="nationality" />
            </Field>
            <Field label="موقع العمل">
              <Input name="work_location" />
            </Field>
            <Field label="تاريخ الالتحاق">
              <Input name="joining_date" type="date" />
            </Field>
            <div className="md:col-span-2">
              <Button type="submit" className="w-full sm:w-auto" data-testid="employee-create-submit">
                إنشاء الموظف
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {employees.length === 0 ? (
        <EmptyState title="لا يوجد موظفون بعد." />
      ) : (
        <div className="space-y-3" data-testid="employees-list">
          {employees.map((employee) => {
            const profile = employee.profiles;
            const status = employee.employment_status as EmploymentStatus;
            const empType = employee.employment_type as EmploymentType | null;
            return (
              <Card key={employee.id} data-testid={`employee-row-${employee.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/employees/${employee.id}`}
                      className="text-base font-semibold text-navy underline-offset-2 hover:underline"
                      data-testid={`employee-link-${employee.id}`}
                    >
                      {profile?.full_name_ar || "بدون اسم"}
                    </Link>
                    <p className="text-sm text-muted">
                      {employee.employee_number ? `${employee.employee_number} · ` : ""}
                      {employee.job_title_ar || "بدون مسمى"}
                      {empType ? ` · ${EMPLOYMENT_TYPE_LABELS[empType].ar}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={employee.is_active ? "success" : "danger"}>
                      {employee.is_active ? "نشط" : "موقوف"}
                    </Badge>
                    <Badge tone="neutral">{EMPLOYMENT_STATUS_LABELS[status]?.ar ?? status}</Badge>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
