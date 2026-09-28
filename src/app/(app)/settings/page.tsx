import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assignRoleAction, setUserActiveAction } from "@/server/use-cases/platform";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";

type RoleRow = { id: string; name_ar: string; code?: string; is_external?: boolean };
type MemberRow = {
  profile_id: string;
  status: string;
  profiles: {
    id: string;
    full_name_ar: string;
    full_name_en: string;
    is_active: boolean;
  } | null;
  employees: Array<{ id: string; job_title_ar: string | null }> | { id: string; job_title_ar: string | null } | null;
};

export default async function SettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canManageUsers = hasPermission(ctx, "user.read") || hasPermission(ctx, "settings.manage");
  if (!canManageUsers && !hasPermission(ctx, "organization.read")) {
    redirect("/");
  }

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [users, roles, audit] = await Promise.all([
    canManageUsers ? repo.listUsers(ctx.organization.id) : Promise.resolve([]),
    canManageUsers ? repo.listRoles() : Promise.resolve([]),
    hasPermission(ctx, "audit.read") ? repo.listAudit(ctx.organization.id, 15) : Promise.resolve([]),
  ]);

  const roleRows = roles as RoleRow[];
  const members = users as unknown as MemberRow[];

  return (
    <PageContainer className="space-y-5">
      <PageHeader title="الإعدادات" description="المنشأة وإدارة المستخدمين وسجل التدقيق" />

      <Card className="mb-6">
        <h2 className="text-base font-semibold text-navy">المنشأة</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">الاسم</dt>
            <dd className="font-medium">{ctx.organization.name_ar}</dd>
          </div>
          <div>
            <dt className="text-muted">English</dt>
            <dd className="font-medium">{ctx.organization.name_en}</dd>
          </div>
          <div>
            <dt className="text-muted">المنطقة الزمنية</dt>
            <dd className="font-medium">{ctx.organization.timezone}</dd>
          </div>
          <div>
            <dt className="text-muted">العملة</dt>
            <dd className="font-medium">{ctx.organization.default_currency}</dd>
          </div>
          <div>
            <dt className="text-muted">الحالة</dt>
            <dd>
              <Badge tone="success">{ctx.organization.status}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      {canManageUsers ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-navy">المستخدمون والصلاحيات</h2>
          {members.length === 0 ? (
            <EmptyState title="لا يوجد أعضاء." />
          ) : (
            <div className="space-y-4">
              {members.map((member) => {
                const profile = member.profiles;
                if (!profile) return null;
                const employee = Array.isArray(member.employees)
                  ? member.employees[0]
                  : member.employees;
                return (
                  <div key={member.profile_id} className="rounded-md border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-navy">{profile.full_name_ar}</p>
                        <p className="text-xs text-muted">
                          {employee?.job_title_ar || "—"} · عضوية: {member.status}
                        </p>
                      </div>
                      <Badge tone={profile.is_active ? "success" : "danger"}>
                        {profile.is_active ? "نشط" : "موقوف"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {hasPermission(ctx, "role.assign") ? (
                        <ServerActionForm action={assignRoleAction} className="flex items-end gap-2">
                          <input type="hidden" name="profileId" value={profile.id} />
                          <Field label="دور">
                            <Select name="roleId" required defaultValue="">
                              <option value="" disabled>
                                اختر
                              </option>
                              {roleRows
                                .filter((role) =>
                                  isOperationalAssignableRole({
                                    code: role.code,
                                    is_external: role.is_external,
                                    allowPrivileged: ctx.profile.is_platform_admin,
                                  }),
                                )
                                .map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {role.name_ar}
                                  </option>
                                ))}
                            </Select>
                          </Field>
                          <Button type="submit" variant="secondary">
                            تعيين
                          </Button>
                        </ServerActionForm>
                      ) : null}
                      {hasPermission(ctx, "user.disable") && profile.id !== ctx.userId ? (
                        <ServerActionForm action={setUserActiveAction}>
                          <input type="hidden" name="profileId" value={profile.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={profile.is_active ? "false" : "true"}
                          />
                          <Button type="submit" variant={profile.is_active ? "danger" : "primary"}>
                            {profile.is_active ? "إيقاف" : "تفعيل"}
                          </Button>
                        </ServerActionForm>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {hasPermission(ctx, "audit.read") ? (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-navy">سجل التدقيق</h2>
          {audit.length === 0 ? (
            <EmptyState title="لا يوجد سجل بعد." />
          ) : (
            <ul className="space-y-3">
              {audit.map((item) => (
                <li key={item.id} className="border-b border-line pb-3 text-sm last:border-0">
                  <p className="font-medium text-navy">{auditActionLabel(item.action)}</p>
                  <p className="text-xs text-muted">
                    {auditEntityLabel(item.entity_type)} ·{" "}
                    {new Date(item.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </PageContainer>
  );
}
