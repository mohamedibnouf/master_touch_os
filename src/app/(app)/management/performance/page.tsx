import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Section, TableScroll } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement } from "@/modules/management/access";
import { intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function ManagementPerformancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t, locale } = await getI18n();
  const copy = t.management.performance;
  const nf = intlLocale(locale);

  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();
  const { data: steps } = await supabase
    .from("approval_steps")
    .select("user_id, status, due_at")
    .eq("organization_id", ctx.organization.id)
    .not("user_id", "is", null)
    .limit(500);

  const byUser = new Map<string, { assigned: number; completed: number; overdue: number }>();
  for (const row of steps ?? []) {
    const id = row.user_id as string;
    const cur = byUser.get(id) ?? { assigned: 0, completed: 0, overdue: 0 };
    cur.assigned += 1;
    if (["approved", "rejected", "completed"].includes(row.status as string)) cur.completed += 1;
    if (
      row.due_at &&
      (row.due_at as string) < now &&
      ["pending", "in_progress"].includes(row.status as string)
    ) {
      cur.overdue += 1;
    }
    byUser.set(id, cur);
  }

  const ids = [...byUser.keys()].slice(0, 40);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name_ar, full_name_en").in("id", ids)
    : { data: [] };
  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      pickLocalized(locale, p.full_name_ar as string | null, p.full_name_en as string | null),
    ]),
  );
  const rows = ids.map((id) => {
    const s = byUser.get(id)!;
    return {
      profileId: id,
      displayName: names.get(id) || id.slice(0, 8),
      assignedApprovals: s.assigned,
      completedApprovals: s.completed,
      overdueApprovals: s.overdue,
    };
  });

  return (
    <PageContainer data-testid="management-performance" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/performance" />
      {rows.length === 0 ? (
        <EmptyState title={copy.empty} />
      ) : (
        <Section title={copy.tableTitle}>
          <TableScroll>
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-xs text-muted">
                  <th className="px-3 py-2 text-start font-semibold">{copy.colOwner}</th>
                  <th className="px-3 py-2 text-end font-semibold">{copy.colAssigned}</th>
                  <th className="px-3 py-2 text-end font-semibold">{copy.colCompleted}</th>
                  <th className="px-3 py-2 text-end font-semibold">{copy.colOverdue}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.profileId} className="border-b border-line last:border-b-0 hover:bg-surface-muted/60">
                    <td className="px-3 py-2 font-medium text-ink">{r.displayName}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.assignedApprovals.toLocaleString(nf)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.completedApprovals.toLocaleString(nf)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-end tabular-nums",
                        r.overdueApprovals > 0 ? "font-semibold text-danger" : "text-muted",
                      )}
                    >
                      {r.overdueApprovals.toLocaleString(nf)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      )}
    </PageContainer>
  );
}
