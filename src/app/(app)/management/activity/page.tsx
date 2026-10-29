import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementActivityPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.activity) redirect("/management");

  const { t, locale } = await getI18n();
  const copy = t.management.activity;

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    {
      ...sections,
      projects: false,
      approvals: false,
      procurement: false,
      finance: false,
      people: false,
      attendanceLeave: false,
      payroll: false,
    },
  );

  return (
    <PageContainer data-testid="management-activity-page" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/activity" />
      {snapshot.activity.length === 0 ? (
        <EmptyState title={copy.empty} />
      ) : (
        <Section>
          <ul className="divide-y divide-line text-sm" data-testid="management-activity-list">
            {snapshot.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{auditActionLabel(a.action, locale)}</p>
                  <p className="text-muted">
                    {auditEntityLabel(a.entityType, locale)}
                    {a.entityId ? (
                      <span className="font-mono text-xs" dir="ltr">
                        {` · ${a.entityId.slice(0, 8)}…`}
                      </span>
                    ) : null}
                  </p>
                </div>
                <p className="shrink-0 text-xs tabular-nums text-muted">
                  {new Date(a.createdAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageContainer>
  );
}
