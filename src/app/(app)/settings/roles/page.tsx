import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CoreRepository } from "@/server/repositories/core.repository";
import { RoleRepository } from "@/server/repositories/role.repository";
import { CustomRoleForm } from "@/components/settings/custom-role-form";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setCustomRoleActiveAction } from "@/server/use-cases/roles";
import { delegablePermissionKeysForActor } from "@/lib/rbac/custom-roles";
import { groupPermissionKeys } from "@/lib/rbac/permission-groups";
import { Shield } from "lucide-react";

export default async function RolesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; edit?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const canRead = hasPermission(ctx, "role.read") || hasPermission(ctx, "role.manage");
  if (!canRead) redirect("/");
  const canManage = hasPermission(ctx, "role.manage");
  const params = await searchParams;
  const tab = params.tab === "system" ? "system" : "custom";

  const supabase = await createServerSupabaseClient();
  const roles = new RoleRepository(supabase);
  const departments = await new CoreRepository(supabase).listDepartments(ctx.organization.id);
  const [systemRoles, customRoles] = await Promise.all([
    roles.listSystemRoles(),
    roles.listCustomRoles(ctx.organization.id),
  ]);
  const allIds = [...systemRoles, ...customRoles].map((role) => role.id);
  const [permissions, assignmentCounts] = await Promise.all([
    roles.listPermissions(allIds),
    roles.countAssignments(ctx.organization.id, allIds),
  ]);
  const keysByRole = new Map<string, string[]>();
  for (const row of permissions) {
    const list = keysByRole.get(row.role_id) ?? [];
    list.push(row.permission_key);
    keysByRole.set(row.role_id, list);
  }
  const deptName = new Map(departments.filter((d) => d.is_active).map((d) => [d.id, d.name_ar]));
  const pickerGroups = groupPermissionKeys(delegablePermissionKeysForActor(ctx.permissions));
  const editing = customRoles.find((role) => role.id === params.edit);

  return (
    <PageContainer data-testid="roles-settings-page" className="space-y-5">
      <PageHeader
        title="الأدوار والصلاحيات"
        description="إدارة الأدوار المخصصة وصلاحيات الوصول داخل الشركة. المسمى الوظيفي مهنة مستقلة وليس صلاحية."
        actions={
          <Link
            href="/settings"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line bg-white px-4 text-sm font-medium text-navy md:min-h-10"
          >
            الإعدادات
          </Link>
        }
      />

      <nav className="flex gap-1 border-b border-line pb-2" aria-label="أقسام الأدوار">
        <Link
          href="/settings/roles"
          className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${tab === "custom" ? "bg-navy text-white" : "text-muted hover:bg-white"}`}
        >
          الأدوار المخصصة
        </Link>
        <Link
          href="/settings/roles?tab=system"
          className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${tab === "system" ? "bg-navy text-white" : "text-muted hover:bg-white"}`}
        >
          أدوار النظام
        </Link>
      </nav>

      {tab === "custom" ? (
        <>
          {canManage ? (
            <div className="mx-auto w-full max-w-4xl">
              <div className="mt-surface p-4 md:p-6">
                <FormSection
                  icon={Shield}
                  title={editing ? "تعديل دور مخصص" : "إنشاء دور مخصص"}
                  description="الصلاحيات تُختار من الكتالوج المعتمد فقط، وبما تملكه حالياً."
                >
                  <CustomRoleForm
                    departments={departments.filter((d) => d.is_active).map((d) => ({ id: d.id, name_ar: d.name_ar }))}
                    groups={pickerGroups}
                    role={
                      editing
                        ? {
                            id: editing.id,
                            name_ar: editing.name_ar,
                            name_en: editing.name_en,
                            code: editing.code,
                            department_id: editing.department_id,
                            permission_keys: keysByRole.get(editing.id) ?? [],
                          }
                        : undefined
                    }
                  />
                </FormSection>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">عرض فقط — إدارة الأدوار المخصصة تتطلب صلاحية إدارة الأدوار.</p>
          )}

          {customRoles.length === 0 ? (
            <EmptyState title="لا توجد أدوار مخصصة بعد." />
          ) : (
            <div className="space-y-3">
              {customRoles.map((role) => {
                const permCount = keysByRole.get(role.id)?.length ?? 0;
                const users = assignmentCounts.get(role.id) ?? 0;
                return (
                  <Card key={role.id} data-testid={`custom-role-${role.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-navy">{role.name_ar}</h2>
                        <p className="text-sm text-muted">{role.name_en}</p>
                        <p className="mt-1 text-xs text-muted">
                          الرمز: {role.code} · الإدارة المرتبطة: {role.department_id ? deptName.get(role.department_id) ?? "—" : "بدون"} · صلاحيات: {permCount} · مستخدمون: {users}
                        </p>
                        <p className="text-xs text-muted">
                          أُنشئ: {new Date(role.created_at).toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" })}
                        </p>
                      </div>
                      <Badge tone={role.is_active ? "success" : "danger"}>
                        {role.is_active ? "نشط" : "موقوف"}
                      </Badge>
                    </div>
                    {canManage ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/settings/roles?edit=${role.id}`}
                          className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm font-medium text-navy"
                        >
                          تعديل
                        </Link>
                        <ServerActionForm action={setCustomRoleActiveAction}>
                          <input type="hidden" name="roleId" value={role.id} />
                          <input type="hidden" name="isActive" value={role.is_active ? "false" : "true"} />
                          <Button type="submit" variant={role.is_active ? "danger" : "secondary"}>
                            {role.is_active ? "إيقاف" : "إعادة تفعيل"}
                          </Button>
                        </ServerActionForm>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          {systemRoles.map((role) => (
            <Card key={role.id} data-testid={`system-role-${role.code}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-navy">{role.name_ar}</h2>
                  <p className="text-sm text-muted">{role.name_en}</p>
                  <p className="mt-1 text-xs text-muted">
                    الرمز: {role.code} · صلاحيات: {keysByRole.get(role.id)?.length ?? 0} · مستخدمون: {assignmentCounts.get(role.id) ?? 0}
                  </p>
                </div>
                <Badge tone="navy">دور نظام</Badge>
              </div>
              <ul className="mt-3 columns-1 gap-2 text-xs text-muted sm:columns-2">
                {(keysByRole.get(role.id) ?? []).sort().map((key) => (
                  <li key={key} className="font-mono">
                    {key}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
