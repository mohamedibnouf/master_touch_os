import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";

function formatTs(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

export default async function AttendanceHistoryPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.view_self") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/");
  }
  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title="سجل الحضور" description="لا يوجد سجل موظف مرتبط بحسابك." />
        <EmptyState title="تواصل مع الموارد البشرية لربط حسابك بملف موظف." />
      </PageContainer>
    );
  }

  const supabase = await createServerSupabaseClient();
  const records = await new AttendanceRepository(supabase).listRecordsForEmployee(
    ctx.organization.id,
    ctx.employee.id,
    { limit: 90 },
  );

  return (
    <PageContainer data-testid="attendance-history" className="space-y-5">
      <PageHeader
        title="سجل الحضور"
        description="آخر 90 يوماً"
        actions={
          <Link href="/attendance">
            <Button variant="secondary">اليوم</Button>
          </Link>
        }
      />

      <Card className="overflow-x-auto p-0">
        {records.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا يوجد سجل حضور." />
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">دخول</th>
                <th className="px-4 py-3 text-right">انصراف</th>
                <th className="px-4 py-3 text-right">دقائق العمل</th>
                <th className="px-4 py-3 text-right">تأخير</th>
                <th className="px-4 py-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-line" data-testid="attendance-history-row">
                  <td className="px-4 py-3">{r.attendance_date}</td>
                  <td className="px-4 py-3">{formatTs(r.check_in_at)}</td>
                  <td className="px-4 py-3">{formatTs(r.check_out_at)}</td>
                  <td className="px-4 py-3">{r.worked_minutes}</td>
                  <td className="px-4 py-3">{r.late_minutes}</td>
                  <td className="px-4 py-3">
                    <Badge>{attendanceStatusLabel(r.attendance_status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
