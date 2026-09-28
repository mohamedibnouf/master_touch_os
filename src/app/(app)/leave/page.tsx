import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";

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
  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title="الإجازات" description="لا يوجد سجل موظف مرتبط بحسابك." />
        <EmptyState title="تواصل مع الموارد البشرية لربط حسابك بملف موظف." />
      </PageContainer>
    );
  }

  const year = new Date().getFullYear();
  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const [types, balances, requests] = await Promise.all([
    repo.listLeaveTypes(ctx.organization.id, true),
    repo.listBalances(ctx.organization.id, ctx.employee.id, year),
    repo.listRequestsForEmployee(ctx.organization.id, ctx.employee.id),
  ]);

  const typeMap = new Map(types.map((t) => [t.id, t]));
  const pending = requests.filter((r) => r.status === "submitted");
  const canRequest = hasPermission(ctx, "leave.request");
  const canTeam = hasPermission(ctx, "leave.view_team") || hasPermission(ctx, "leave.approve_manager");
  const canHr = hasPermission(ctx, "leave.view_all") || hasPermission(ctx, "leave.manage");

  return (
    <PageContainer data-testid="leave-dashboard" className="space-y-5">
      <PageHeader
        title="إجازاتي"
        description={`أرصدة وطلبات الإجازة لعام ${year}`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canRequest ? (
              <Link href="/leave/new">
                <Button className="w-full sm:w-auto" data-testid="leave-request-cta">
                  طلب إجازة
                </Button>
              </Link>
            ) : null}
            {canTeam ? (
              <Link href="/leave/team">
                <Button variant="secondary" className="w-full sm:w-auto">
                  إجازات الفريق
                </Button>
              </Link>
            ) : null}
            {canHr ? (
              <Link href="/hr/leave">
                <Button variant="secondary" className="w-full sm:w-auto">
                  إدارة الإجازات
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {balances.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">لا توجد أرصدة مسجّلة بعد. ستُنشأ عند أول طلب.</p>
          </Card>
        ) : (
          balances.map((b) => {
            const t = typeMap.get(b.leave_type_id);
            return (
              <Card key={b.id} className="mt-metric mt-tint-navy">
                <p className="text-[11px] font-medium text-muted">{t?.name_ar ?? b.leave_type_id}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-navy">{b.available_days}</p>
                <p className="mt-1 text-xs text-muted">
                  مستخدم {b.used_days} · معلّق {b.pending_days} · استحقاق {b.entitled_days}
                </p>
              </Card>
            );
          })
        )}
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">طلبات معلّقة</h2>
        {pending.length === 0 ? (
          <EmptyState title="لا توجد طلبات معلّقة." />
        ) : (
          <ul className="space-y-2 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <Link href={`/leave/${r.id}`} className="font-medium text-navy underline">
                  {typeMap.get(r.leave_type_id)?.name_ar ?? "إجازة"} · {r.start_date} → {r.end_date}
                </Link>
                <Badge tone="warning">{leaveStatusLabel(r.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">السجل</div>
        {requests.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا يوجد سجل إجازات بعد." />
          </div>
        ) : (
          <TableScroll>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">النوع</th>
                <th className="px-4 py-3 text-right">من</th>
                <th className="px-4 py-3 text-right">إلى</th>
                <th className="px-4 py-3 text-right">الأيام</th>
                <th className="px-4 py-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <Link href={`/leave/${r.id}`} className="text-navy underline">
                      {typeMap.get(r.leave_type_id)?.name_ar ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.start_date}</td>
                  <td className="px-4 py-3">{r.end_date}</td>
                  <td className="px-4 py-3">{r.total_days}</td>
                  <td className="px-4 py-3">
                    <Badge>{leaveStatusLabel(r.status)}</Badge>
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
