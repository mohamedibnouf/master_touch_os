import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { attendanceStatusTone } from "@/lib/ui/operational-labels";
import { formatAttendanceTime } from "@/components/attendance/attendance-format";
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
    const p = (Array.isArray(profile) ? profile[0] : profile) as { full_name_ar?: string; full_name_en?: string } | null;
    const name = pickLocalized(locale, p?.full_name_ar, p?.full_name_en) || row.id.slice(0, 8);
    map.set(row.id as string, name);
  }
  return map;
}

export default async function AttendanceTeamPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.view_team") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/attendance");
  }
  const { t, locale } = await getI18n();
  const tt = t.attendance.team;
  const tc = t.attendance.common;

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
    locale,
  );

  const late = todayRecords.filter((r) => r.attendance_status === "late").length;
  const absent = todayRecords.filter((r) => r.attendance_status === "absent").length;
  const present = todayRecords.filter((r) =>
    ["present", "late", "partial"].includes(r.attendance_status),
  ).length;

  return (
    <PageContainer data-testid="attendance-team" className="space-y-5">
      <PageHeader
        title={tt.title}
        description={format(tt.description, { date: today })}
        actions={
          <Link href="/attendance">
            <Button variant="secondary">{tt.myAttendanceLink}</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={tt.present}
          tone="success"
          value={<span data-testid="attendance-team-present">{present}</span>}
        />
        <StatCard label={tt.late} tone={late > 0 ? "warning" : "neutral"} value={late} />
        <StatCard label={tt.absent} tone={absent > 0 ? "danger" : "neutral"} value={absent} />
      </div>

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tt.todayTitle}</div>
        {todayRecords.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tt.noToday} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                  <th className="px-4 py-3 text-start font-medium">{tt.checkIn}</th>
                  <th className="px-4 py-3 text-start font-medium">{tt.checkOut}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {todayRecords.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-3 font-medium text-ink">
                      {names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_in_at, locale)}</td>
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_out_at, locale)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={attendanceStatusTone(r.attendance_status)}>
                        {attendanceStatusLabel(r.attendance_status, locale)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tt.weekTitle}</div>
        <TableScroll>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.date}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                <th className="px-4 py-3 text-start font-medium">{tt.lateMinutes}</th>
              </tr>
            </thead>
            <tbody>
              {weekRecords.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3">{names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 tabular-nums">{r.attendance_date}</td>
                  <td className="px-4 py-3">
                    <Badge tone={attendanceStatusTone(r.attendance_status)}>
                      {attendanceStatusLabel(r.attendance_status, locale)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.late_minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        {weekRecords.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tt.noWeek} />
          </div>
        ) : null}
      </Card>
    </PageContainer>
  );
}
