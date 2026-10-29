import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assignRoleAction, setUserActiveAction } from "@/server/use-cases/platform";
import { saveManagementNotificationEmailAction, saveManagementNotificationWhatsappAction } from "@/server/use-cases/notification-preferences";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

type RoleRow = { id: string; name_ar: string; name_en?: string | null; code?: string; is_external?: boolean; is_system?: boolean; is_active?: boolean };
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

  const canManageSettings = hasPermission(ctx, "settings.manage");
  const { t, locale } = await getI18n();
  const ts = t.workspace.settings;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [users, roles, audit] = await Promise.all([
    canManageUsers ? repo.listUsers(ctx.organization.id) : Promise.resolve([]),
    canManageUsers ? repo.listRoles(ctx.organization.id) : Promise.resolve([]),
    hasPermission(ctx, "audit.read") ? repo.listAudit(ctx.organization.id, 15) : Promise.resolve([]),
  ]);

  const { data: orgSettings } = canManageSettings
    ? await supabase
        .from("organizations")
        .select("management_notification_email, management_notification_whatsapp")
        .eq("id", ctx.organization.id)
        .maybeSingle<{ management_notification_email: string | null; management_notification_whatsapp: string | null }>()
    : { data: null };

  const roleRows = roles as RoleRow[];
  const members = users as unknown as MemberRow[];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={ts.title}
        description={ts.description}
        actions={
          hasPermission(ctx, "role.read") || hasPermission(ctx, "role.manage") ? (
            <Link
              href="/settings/roles"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted md:min-h-10"
            >
              {ts.rolesLink}
            </Link>
          ) : null
        }
      />

      <Card className="mb-6">
        <h2 className="text-base font-semibold text-ink">{ts.organization}</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">{ts.nameAr}</dt>
            <dd className="font-medium">{ctx.organization.name_ar}</dd>
          </div>
          <div>
            <dt className="text-muted">{ts.nameEn}</dt>
            <dd className="font-medium">{ctx.organization.name_en}</dd>
          </div>
          <div>
            <dt className="text-muted">{ts.timezone}</dt>
            <dd className="font-medium">{ctx.organization.timezone}</dd>
          </div>
          <div>
            <dt className="text-muted">{ts.currency}</dt>
            <dd className="font-medium">{ctx.organization.default_currency}</dd>
          </div>
          <div>
            <dt className="text-muted">{ts.status}</dt>
            <dd>
              <Badge tone="success">{ctx.organization.status}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      {canManageSettings ? (
        <Card className="mb-6" data-testid="management-notification-email">
          <h2 className="text-base font-semibold text-ink">{ts.managementEmailTitle}</h2>
          <p className="mt-2 text-sm text-muted">
            {ts.managementEmailBody}
          </p>
          <ServerActionForm action={saveManagementNotificationEmailAction} className="mt-4 max-w-md space-y-3">
            <Field label={ts.managementEmailField} hint={ts.managementEmailHint}>
              <Input
                name="management_notification_email"
                type="email"
                dir="ltr"
                defaultValue={orgSettings?.management_notification_email ?? ""}
                autoComplete="off"
              />
            </Field>
            <Button type="submit">{ts.save}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canManageSettings ? (
        <Card className="mb-6" data-testid="management-notification-whatsapp">
          <h2 className="text-base font-semibold text-ink">{ts.managementWhatsappTitle}</h2>
          <p className="mt-2 text-sm text-muted">
            {ts.managementWhatsappBody}
          </p>
          <ServerActionForm action={saveManagementNotificationWhatsappAction} className="mt-4 max-w-md space-y-3">
            <Field label={ts.managementWhatsappField} hint={ts.managementWhatsappHint}>
              <Input
                name="management_notification_whatsapp"
                type="tel"
                dir="ltr"
                defaultValue={orgSettings?.management_notification_whatsapp ?? ""}
                autoComplete="off"
              />
            </Field>
            <Button type="submit">{ts.save}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canManageUsers ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-ink">{ts.usersTitle}</h2>
          {members.length === 0 ? (
            <EmptyState title={ts.noMembers} />
          ) : (
            <div className="space-y-4">
              {members.map((member) => {
                const profile = member.profiles;
                if (!profile) return null;
                const employee = Array.isArray(member.employees)
                  ? member.employees[0]
                  : member.employees;
                return (
                  <div key={member.profile_id} className="rounded-[var(--radius-control)] border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-ink">{pickLocalized(locale, profile.full_name_ar, profile.full_name_en)}</p>
                        <p className="text-xs text-muted">
                          {employee?.job_title_ar || "—"} · {format(ts.membership, { status: member.status })}
                        </p>
                      </div>
                      <Badge tone={profile.is_active ? "success" : "danger"}>
                        {profile.is_active ? ts.active : ts.suspended}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {hasPermission(ctx, "role.assign") ? (
                        <ServerActionForm action={assignRoleAction} className="flex items-end gap-2">
                          <input type="hidden" name="profileId" value={profile.id} />
                          <Field label={ts.roleField}>
                            <Select name="roleId" required defaultValue="">
                              <option value="" disabled>
                                {ts.choose}
                              </option>
                              {roleRows
                                .filter((role) =>
                                  isOperationalAssignableRole({
                                    code: role.code,
                                    is_external: role.is_external,
                                    is_system: role.is_system,
                                    is_active: role.is_active,
                                    allowPrivileged: ctx.profile.is_platform_admin,
                                  }),
                                )
                                .map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {pickLocalized(locale, role.name_ar, role.name_en)}
                                  </option>
                                ))}
                            </Select>
                          </Field>
                          <Button type="submit" variant="secondary">
                            {ts.assign}
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
                            {profile.is_active ? ts.deactivate : ts.activate}
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
          <h2 className="mb-4 text-base font-semibold text-ink">{ts.auditTitle}</h2>
          {audit.length === 0 ? (
            <EmptyState title={ts.auditEmpty} />
          ) : (
            <ul className="space-y-3">
              {audit.map((item) => (
                <li key={item.id} className="border-b border-line pb-3 text-sm last:border-0">
                  <p className="font-medium text-ink">{auditActionLabel(item.action, locale)}</p>
                  <p className="text-xs text-muted">
                    {auditEntityLabel(item.entity_type, locale)} ·{" "}
                    {new Date(item.created_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}
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
