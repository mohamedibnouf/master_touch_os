import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";

export default async function ManagementActivityPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.activity) redirect("/management");

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
    <div data-testid="management-activity-page">
      <PageHeader title="النشاط الحرج" description="إسقاط مقروء من سجل التدقيق — ليس سجلاً خاماً كاملاً" />
      <ManagementNav pathname="/management/activity" />
      <Card>
        {snapshot.activity.length === 0 ? (
          <p className="text-sm text-muted">لا توجد أحداث حديثة.</p>
        ) : (
          <ul className="space-y-3 text-sm" data-testid="management-activity-list">
            {snapshot.activity.map((a) => (
              <li key={a.id} className="border-b border-line pb-3">
                <p className="font-medium text-navy">{a.action}</p>
                <p className="text-muted">
                  {a.entityType}
                  {a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ""}
                </p>
                <p className="tabular-nums text-muted">
                  {new Date(a.createdAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
