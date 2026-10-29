import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, Section, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";
import { leaveRequestTone } from "@/lib/ui/operational-labels";
import { format, pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { addDaysYmd, todayInRiyadh } from "@/lib/time/riyadh";

async function employeeNameMap(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  employeeIds: string[],
  locale: Locale,
): Promise<Map<string, string>> {
  const unique = [...new Set(employeeIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase
    .from("employees")
    .select("id, profiles(full_name_ar, full_name_en)")
    .in("id", unique);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const profile = row.profiles;
    const p = (Array.isArray(profile) ? profile[0] : profile) as
      | { full_name_ar?: string | null; full_name_en?: string | null }
      | null;
    const name = pickLocalized(locale, p?.full_name_ar, p?.full_name_en) || row.id.slice(0, 8);
    map.set(row.id as string, name);
  }
  return map;
}

export default async function LeaveTeamPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "leave.view_team") && !hasPermission(ctx, "leave.approve_manager")) {
    redirect("/leave");
  }

  const { t, locale } = await getI18n();
  const tt = t.leave.team;
  const tc = t.leave.common;

  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const today = todayInRiyadh();
  const in30 = addDaysYmd(today, 30);

  const [pending, types, calendar] = await Promise.all([
    repo.listTeamPending(ctx.organization.id),
    repo.listLeaveTypes(ctx.organization.id, true),
    repo.listCalendar(ctx.organization.id, today, in30),
  ]);

  const typeMap = new Map(types.map((ty) => [ty.id, pickLocalized(locale, ty.name_ar, ty.name_en)]));
  const names = await employeeNameMap(
    supabase,
    [...pending.map((r) => r.employee_id), ...calendar.map((r) => r.employee_id)],
    locale,
  );

  return (
    <PageContainer data-testid="leave-team" className="space-y-5">
      <PageHeader
        title={tt.title}
        description={tt.description}
        actions={
          <Link href="/leave">
            <Button variant="secondary">{tt.myLeave}</Button>
          </Link>
        }
      />

      <Section title={tt.pendingTitle}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">{tt.noPending}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <Link href={`/leave/${r.id}`} className="min-w-0 hover:underline">
                  <span className="font-medium text-primary">{names.get(r.employee_id) ?? tc.employee}</span>
                  <span className="ms-2 text-muted">
                    {typeMap.get(r.leave_type_id) || tc.leave} ·{" "}
                    <span className="tabular-nums">
                      {format(tc.dateRange, { start: r.start_date, end: r.end_date })} (
                      {format(tc.daysShort, { days: r.total_days })})
                    </span>
                  </span>
                </Link>
                <Badge tone="warning">{leaveStatusLabel(r.status, locale)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tt.calendarTitle}</div>
        {calendar.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tt.noUpcoming} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colEmployee}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colType}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colFrom}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colTo}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {calendar.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5">{typeMap.get(r.leave_type_id) || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.start_date}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.end_date}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={leaveRequestTone(r.status)}>{leaveStatusLabel(r.status, locale)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </PageContainer>
  );
}
