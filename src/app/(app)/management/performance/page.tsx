import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement } from "@/modules/management/access";

export default async function ManagementPerformancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

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
    ? await supabase.from("profiles").select("id, full_name_ar").in("id", ids)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name_ar as string]));
  const rows = ids.map((id) => {
    const s = byUser.get(id)!;
    return {
      profileId: id,
      displayName: names.get(id) ?? id.slice(0, 8),
      assignedApprovals: s.assigned,
      completedApprovals: s.completed,
      overdueApprovals: s.overdue,
    };
  });

  return (
    <div data-testid="management-performance">
      <PageHeader
        title="حقائق الأداء التشغيلي"
        description="أعداد قابلة للتفسير فقط. لا يوجد ترتيب أو درجة إنتاجية."
      />
      <ManagementNav pathname="/management/performance" />
      {rows.length === 0 ? (
        <EmptyState title="لا توجد خطوات موافقة كافية لعرض الحقائق." />
      ) : (
        <Card>
          <TableScroll>
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-3 py-2 text-right">المسؤول</th>
                  <th className="px-3 py-2 text-right">مسند</th>
                  <th className="px-3 py-2 text-right">مكتمل</th>
                  <th className="px-3 py-2 text-right">متأخر</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.profileId} className="border-t border-line">
                    <td className="px-3 py-2">{r.displayName}</td>
                    <td className="px-3 py-2">{r.assignedApprovals}</td>
                    <td className="px-3 py-2">{r.completedApprovals}</td>
                    <td className="px-3 py-2">{r.overdueApprovals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
