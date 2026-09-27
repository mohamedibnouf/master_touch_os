import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertDepartmentAction } from "@/server/use-cases/hr";

export default async function DepartmentsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "department.read")) redirect("/");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const departments = await repo.listDepartments(ctx.organization.id);
  const employees =
    hasPermission(ctx, "employee.read") || hasPermission(ctx, "department.update")
      ? await repo.listEmployeeNameOptions(ctx.organization.id)
      : [];

  const canCreate = hasPermission(ctx, "department.create");
  const canUpdate = hasPermission(ctx, "department.update");
  const byId = new Map(departments.map((d) => [d.id, d]));

  const roots = departments.filter((d) => !d.parent_department_id);
  const childrenOf = (parentId: string) => departments.filter((d) => d.parent_department_id === parentId);

  function renderTree(nodes: typeof departments, depth = 0): ReactNode {
    return nodes.map((department) => (
      <div key={department.id} style={{ marginInlineStart: depth * 16 }} className="mb-3">
        <Card data-testid={`department-card-${department.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-bronze">{department.code}</p>
              <h2 className="mt-1 text-base font-semibold text-navy">{department.name_ar}</h2>
              <p className="text-sm text-muted">{department.name_en}</p>
              {department.parent_department_id ? (
                <p className="mt-1 text-xs text-muted">
                  تابع لـ: {byId.get(department.parent_department_id)?.name_ar ?? "—"}
                </p>
              ) : null}
            </div>
            <Badge tone={department.is_active ? "success" : "neutral"}>
              {department.is_active ? "نشطة" : "موقوفة"}
            </Badge>
          </div>
          {canUpdate ? (
            <ServerActionForm action={upsertDepartmentAction} className="mt-4 grid gap-2 border-t border-line pt-3 md:grid-cols-2">
              <input type="hidden" name="departmentId" value={department.id} />
              <Field label="الرمز">
                <Input name="code" required defaultValue={department.code} />
              </Field>
              <Field label="نشطة؟">
                <Select name="is_active" defaultValue={department.is_active ? "true" : "false"}>
                  <option value="true">نشطة</option>
                  <option value="false">موقوفة</option>
                </Select>
              </Field>
              <Field label="الاسم عربي">
                <Input name="name_ar" required defaultValue={department.name_ar} />
              </Field>
              <Field label="الاسم إنجليزي">
                <Input name="name_en" required defaultValue={department.name_en} />
              </Field>
              <Field label="القسم الأب">
                <Select name="parent_department_id" defaultValue={department.parent_department_id ?? ""}>
                  <option value="">بدون</option>
                  {departments
                    .filter((d) => d.id !== department.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {d.name_ar}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="المدير">
                <Select name="manager_user_id" defaultValue={department.manager_user_id ?? ""}>
                  <option value="">بدون</option>
                  {employees.map((e) => (
                    <option key={e.profile_id} value={e.profile_id}>
                      {e.profiles?.full_name_ar || e.profile_id}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="الوصف">
                  <Input name="description" defaultValue={department.description ?? ""} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" variant="secondary" data-testid={`department-update-${department.id}`}>
                  حفظ التعديلات
                </Button>
              </div>
            </ServerActionForm>
          ) : null}
        </Card>
        {renderTree(childrenOf(department.id), depth + 1)}
      </div>
    ));
  }

  return (
    <div data-testid="departments-page">
      <PageHeader title="الإدارات" description="هيكل تنظيمي هرمي قابل للتهيئة داخل المؤسسة" />

      {canCreate ? (
        <Card className="mb-6" data-testid="department-create-card">
          <h2 className="mb-3 font-semibold text-navy">إنشاء إدارة</h2>
          <ServerActionForm action={upsertDepartmentAction} className="grid gap-3 md:grid-cols-2">
            <Field label="الرمز">
              <Input name="code" required data-testid="department-create-code" />
            </Field>
            <Field label="نشطة؟">
              <Select name="is_active" defaultValue="true">
                <option value="true">نشطة</option>
                <option value="false">موقوفة</option>
              </Select>
            </Field>
            <Field label="الاسم عربي">
              <Input name="name_ar" required data-testid="department-create-name-ar" />
            </Field>
            <Field label="الاسم إنجليزي">
              <Input name="name_en" required data-testid="department-create-name-en" />
            </Field>
            <Field label="القسم الأب">
              <Select name="parent_department_id" defaultValue="" data-testid="department-create-parent">
                <option value="">بدون (جذر)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المدير">
              <Select name="manager_user_id" defaultValue="">
                <option value="">بدون</option>
                {employees.map((e) => (
                  <option key={e.profile_id} value={e.profile_id}>
                    {e.profiles?.full_name_ar || e.profile_id}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Button type="submit" data-testid="department-create-submit">
                إنشاء
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {departments.length === 0 ? (
        <EmptyState title="لا توجد إدارات." />
      ) : (
        <div data-testid="departments-tree">{renderTree(roots.length > 0 ? roots : departments)}</div>
      )}
    </div>
  );
}
