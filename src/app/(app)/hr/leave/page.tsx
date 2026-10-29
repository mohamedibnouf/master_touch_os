import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, Section, StatCard, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";
import { leaveRequestTone } from "@/lib/ui/operational-labels";
import { format, pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

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

export default async function HrLeavePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "leave.view_all") && !hasPermission(ctx, "leave.manage")) {
    redirect("/leave");
  }

  const { t, locale } = await getI18n();
  const th = t.leave.hr;
  const tc = t.leave.common;

  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const today = new Date().toISOString().slice(0, 10);
  const in14Date = new Date(today);
  in14Date.setUTCDate(in14Date.getUTCDate() + 14);
  const in14 = in14Date.toISOString().slice(0, 10);

  const [pending, types, calendar] = await Promise.all([
    repo.listHrPending(ctx.organization.id),
    repo.listLeaveTypes(ctx.organization.id),
    repo.listCalendar(ctx.organization.id, today, in14),
  ]);

  const typeMap = new Map(types.map((ty) => [ty.id, pickLocalized(locale, ty.name_ar, ty.name_en)]));
  const names = await employeeNameMap(
    supabase,
    [...pending.map((r) => r.employee_id), ...calendar.map((r) => r.employee_id)],
    locale,
  );
  const onLeave = calendar.filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today);
  const upcoming = calendar.filter((r) => r.start_date > today);
  const lowBalanceHint = types.filter((ty) => ty.is_active && ty.annual_entitlement_days > 0).length;

  return (
    <PageContainer data-testid="leave-hr-dashboard" className="space-y-5">
      <PageHeader
        title={th.title}
        description={th.description}
        actions={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/hr/leave/types">
              <Button variant="secondary" className="w-full sm:w-auto">
                {th.types}
              </Button>
            </Link>
            <Link href="/hr/leave/balances">
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="leave-balances-link">
                {th.balances}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={th.pendingHr}
          tone={pending.length > 0 ? "warning" : "neutral"}
          value={<span data-testid="leave-hr-pending-count">{pending.length}</span>}
        />
        <StatCard label={th.onLeaveNow} tone="info" value={onLeave.length} />
        <StatCard label={th.upcoming} value={upcoming.length} />
      </div>

      {lowBalanceHint > 0 ? (
        <p className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-muted">{th.lowBalanceHint}</p>
      ) : null}

      <Section title={th.pendingTitle}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">{th.noPending}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <Link href={`/leave/${r.id}`} className="min-w-0 hover:underline" data-testid="leave-hr-pending-item">
                  <span className="font-medium text-primary">{names.get(r.employee_id) ?? tc.employee}</span>
                  <span className="ms-2 text-muted">
                    {typeMap.get(r.leave_type_id) || tc.leave} ·{" "}
                    <span className="tabular-nums">{format(tc.dateRange, { start: r.start_date, end: r.end_date })}</span>
                  </span>
                </Link>
                <Badge tone="warning">{leaveStatusLabel(r.status, locale)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{th.calendarTitle}</div>
        {calendar.length === 0 ? (
          <div className="p-4">
            <EmptyState title={th.noUpcoming} />
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
