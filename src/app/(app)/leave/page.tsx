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
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { todayInRiyadh } from "@/lib/time/riyadh";

export default async function LeaveDashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (
    !hasPermission(ctx, "leave.view_self") &&
    !hasPermission(ctx, "leave.request") &&
    !hasPermission(ctx, "leave.view_all")
  ) {
    redirect("/");
  }
  const { t, locale } = await getI18n();
  const tl = t.leave.dashboard;
  const tc = t.leave.common;

  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title={tl.noEmployeeTitle} description={tl.noEmployeeDescription} />
        <EmptyState title={tl.noEmployeeHint} />
      </PageContainer>
    );
  }

  const year = Number(todayInRiyadh().slice(0, 4));
  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const [types, balances, requests] = await Promise.all([
    repo.listLeaveTypes(ctx.organization.id, true),
    repo.listBalances(ctx.organization.id, ctx.employee.id, year),
    repo.listRequestsForEmployee(ctx.organization.id, ctx.employee.id),
  ]);

  const typeMap = new Map(types.map((ty) => [ty.id, pickLocalized(locale, ty.name_ar, ty.name_en)]));
  const pending = requests.filter((r) => r.status === "submitted");
  const canRequest = hasPermission(ctx, "leave.request");
  const canTeam = hasPermission(ctx, "leave.view_team") || hasPermission(ctx, "leave.approve_manager");
  const canHr = hasPermission(ctx, "leave.view_all") || hasPermission(ctx, "leave.manage");

  return (
    <PageContainer data-testid="leave-dashboard" className="space-y-5">
      <PageHeader
        title={tl.title}
        description={format(tl.description, { year })}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canRequest ? (
              <Link href="/leave/new">
                <Button className="w-full sm:w-auto" data-testid="leave-request-cta">
                  {tl.requestCta}
                </Button>
              </Link>
            ) : null}
            {canTeam ? (
              <Link href="/leave/team">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {tl.teamLeave}
                </Button>
              </Link>
            ) : null}
            {canHr ? (
              <Link href="/hr/leave">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {tl.hrLeave}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <section aria-label={tl.balancesTitle} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {balances.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{tl.noBalances}</p>
          </Card>
        ) : (
          balances.map((b) => (
            <Card key={b.id} className="mt-metric mt-tint-navy">
              <p className="text-xs font-medium text-muted">{typeMap.get(b.leave_type_id) || b.leave_type_id}</p>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[1.75rem] font-semibold leading-none tabular-nums text-ink">{b.available_days}</span>
                <span className="text-xs text-muted">{tl.availableDays}</span>
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                <div>
                  <dt className="text-muted">{tl.used}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-ink">{b.used_days}</dd>
                </div>
                <div>
                  <dt className="text-muted">{tl.pending}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-ink">{b.pending_days}</dd>
                </div>
                <div>
                  <dt className="text-muted">{tl.entitled}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-ink">{b.entitled_days}</dd>
                </div>
              </dl>
            </Card>
          ))
        )}
      </section>

      <Section title={tl.pendingTitle}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">{tl.noPending}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <Link href={`/leave/${r.id}`} className="font-medium text-primary hover:underline">
                  {typeMap.get(r.leave_type_id) || tc.leave}
                  <span className="ms-2 font-normal tabular-nums text-muted">
                    {format(tc.dateRange, { start: r.start_date, end: r.end_date })}
                  </span>
                </Link>
                <Badge tone={leaveRequestTone(r.status)}>{leaveStatusLabel(r.status, locale)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tl.historyTitle}</div>
        {requests.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tl.noHistory} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colType}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colFrom}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colTo}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colDays}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <Link href={`/leave/${r.id}`} className="font-medium text-primary hover:underline">
                        {typeMap.get(r.leave_type_id) || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{r.start_date}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.end_date}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.total_days}</td>
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
