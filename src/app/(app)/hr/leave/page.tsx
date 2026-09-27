import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";

async function employeeNameMap(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  employeeIds: string[],
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
    const p = Array.isArray(profile) ? profile[0] : profile;
    const name =
      (p as { full_name_ar?: string; full_name_en?: string } | null)?.full_name_ar ||
      (p as { full_name_ar?: string; full_name_en?: string } | null)?.full_name_en ||
      row.id.slice(0, 8);
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

  const typeMap = new Map(types.map((t) => [t.id, t.name_ar]));
  const names = await employeeNameMap(
    supabase,
    [...pending.map((r) => r.employee_id), ...calendar.map((r) => r.employee_id)],
  );
  const onLeave = calendar.filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today);
  const upcoming = calendar.filter((r) => r.start_date > today);
  const lowBalanceHint = types.filter((t) => t.is_active && t.annual_entitlement_days > 0).length;

  return (
    <div data-testid="leave-hr-dashboard">
      <PageHeader
        title="إدارة الإجازات"
        description="اعتماد الموارد البشرية ومراقبة الأرصدة"
        actions={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/hr/leave/types">
              <Button variant="secondary" className="w-full sm:w-auto">
                أنواع الإجازة
              </Button>
            </Link>
            <Link href="/hr/leave/balances">
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="leave-balances-link">
                الأرصدة
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">بانتظار HR</p>
          <p className="mt-1 text-2xl font-semibold text-navy" data-testid="leave-hr-pending-count">
            {pending.length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">حالياً في إجازة</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{onLeave.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">قادمة (14 يوماً)</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{upcoming.length}</p>
        </Card>
      </div>

      {lowBalanceHint > 0 ? (
        <Card className="mb-6">
          <p className="text-sm text-muted">
            تنبيه أرصدة: راجع صفحة الأرصدة للموظفين ذوي الرصيد المنخفض أو السالب بعد التعديلات.
          </p>
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">بانتظار اعتماد الموارد البشرية</h2>
        {pending.length === 0 ? (
          <EmptyState title="لا توجد طلبات بانتظار HR." />
        ) : (
          <ul className="space-y-2 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <Link href={`/leave/${r.id}`} className="font-medium text-navy underline" data-testid="leave-hr-pending-item">
                  {names.get(r.employee_id) ?? "موظف"} · {typeMap.get(r.leave_type_id) ?? "إجازة"} ·{" "}
                  {r.start_date} → {r.end_date}
                </Link>
                <Badge tone="warning">{leaveStatusLabel(r.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">تقويم المؤسسة (بدون الأسباب)</div>
        <TableScroll>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموظف</th>
              <th className="px-4 py-3 text-right">النوع</th>
              <th className="px-4 py-3 text-right">من</th>
              <th className="px-4 py-3 text-right">إلى</th>
              <th className="px-4 py-3 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {calendar.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-3">{names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{typeMap.get(r.leave_type_id) ?? "—"}</td>
                <td className="px-4 py-3">{r.start_date}</td>
                <td className="px-4 py-3">{r.end_date}</td>
                <td className="px-4 py-3">
                  <Badge>{leaveStatusLabel(r.status)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Card>
    </div>
  );
}