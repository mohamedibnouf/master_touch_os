import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";

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

function formatTs(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

export default async function AttendanceTeamPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.view_team") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/attendance");
  }

  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - 6);
  const from = fromDate.toISOString().slice(0, 10);

  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [todayRecords, weekRecords] = await Promise.all([
    repo.listRecordsForDate(ctx.organization.id, today),
    repo.listTeamRecords(ctx.organization.id, from, today),
  ]);
  const names = await employeeNameMap(
    supabase,
    [...todayRecords.map((r) => r.employee_id), ...weekRecords.map((r) => r.employee_id)],
  );

  const late = todayRecords.filter((r) => r.attendance_status === "late").length;
  const absent = todayRecords.filter((r) => r.attendance_status === "absent").length;
  const present = todayRecords.filter((r) =>
    ["present", "late", "partial"].includes(r.attendance_status),
  ).length;

  return (
    <div data-testid="attendance-team">
      <PageHeader
        title="حضور الفريق"
        description={`اليوم ${today}`}
        actions={
          <Link href="/attendance">
            <Button variant="secondary">حضوري</Button>
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">حاضرون</p>
          <p className="mt-1 text-2xl font-semibold text-navy" data-testid="attendance-team-present">
            {present}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">متأخرون</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{late}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">غائبون</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{absent}</p>
        </Card>
      </div>

      <Card className="mb-6 overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">حضور اليوم</div>
        {todayRecords.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد سجلات لليوم بعد." />
          </div>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">دخول</th>
                <th className="px-4 py-3 text-right">انصراف</th>
                <th className="px-4 py-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {todayRecords.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3">{names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{formatTs(r.check_in_at)}</td>
                  <td className="px-4 py-3">{formatTs(r.check_out_at)}</td>
                  <td className="px-4 py-3">
                    <Badge>{attendanceStatusLabel(r.attendance_status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">آخر 7 أيام</div>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموظف</th>
              <th className="px-4 py-3 text-right">التاريخ</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">تأخير (د)</th>
            </tr>
          </thead>
          <tbody>
            {weekRecords.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-3">{names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{r.attendance_date}</td>
                <td className="px-4 py-3">
                  <Badge>{attendanceStatusLabel(r.attendance_status)}</Badge>
                </td>
                <td className="px-4 py-3">{r.late_minutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {weekRecords.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد سجلات في الفترة." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
