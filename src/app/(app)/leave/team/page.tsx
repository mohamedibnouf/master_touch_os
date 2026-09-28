import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
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

export default async function LeaveTeamPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "leave.view_team") && !hasPermission(ctx, "leave.approve_manager")) {
    redirect("/leave");
  }

  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const today = new Date().toISOString().slice(0, 10);
  const in30Date = new Date(today);
  in30Date.setUTCDate(in30Date.getUTCDate() + 30);
  const in30 = in30Date.toISOString().slice(0, 10);

  const [pending, types, calendar] = await Promise.all([
    repo.listTeamPending(ctx.organization.id),
    repo.listLeaveTypes(ctx.organization.id, true),
    repo.listCalendar(ctx.organization.id, today, in30),
  ]);

  const typeMap = new Map(types.map((t) => [t.id, t.name_ar]));
  const names = await employeeNameMap(
    supabase,
    [...pending.map((r) => r.employee_id), ...calendar.map((r) => r.employee_id)],
  );

  return (
    <PageContainer data-testid="leave-team" className="space-y-5">
      <PageHeader
        title="إجازات الفريق"
        description="طلبات بانتظار اعتماد المدير المباشر"
        actions={
          <Link href="/leave">
            <Button variant="secondary">إجازاتي</Button>
          </Link>
        }
      />

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">بانتظار اعتمادي</h2>
        {pending.length === 0 ? (
          <EmptyState title="لا توجد طلبات بانتظارك." />
        ) : (
          <ul className="space-y-2 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <Link href={`/leave/${r.id}`} className="font-medium text-navy underline">
                  {names.get(r.employee_id) ?? "موظف"} · {typeMap.get(r.leave_type_id) ?? "إجازة"} ·{" "}
                  {r.start_date} → {r.end_date} ({r.total_days}ي)
                </Link>
                <Badge tone="warning">{leaveStatusLabel(r.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">تقويم الفريق (30 يوماً)</div>
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
        {calendar.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد إجازات في الفترة القادمة." />
          </div>
        ) : null}
      </Card>
    </PageContainer>
  );
}
