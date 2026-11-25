import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { attendanceStatusTone } from "@/lib/ui/operational-labels";
import { formatAttendanceTime } from "@/components/attendance/attendance-format";
import { getI18n } from "@/lib/i18n/server";
import { pickLocalized } from "@/lib/i18n/config";

export default async function AttendanceHistoryPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.view_self") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/");
  }
  const { t, locale } = await getI18n();
  const th = t.attendance.history;
  const tc = t.attendance.common;
  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title={th.title} description={tc.noEmployee} />
        <EmptyState title={tc.noEmployeeHint} />
      </PageContainer>
    );
  }

  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [records, shifts] = await Promise.all([
    repo.listRecordsForEmployee(ctx.organization.id, ctx.employee.id, { limit: 90 }),
    repo.listShifts(ctx.organization.id),
  ]);
  const shiftNames = new Map(shifts.map((s) => [s.id, pickLocalized(locale, s.name_ar, s.name_en)]));
  const showShift = new Set(records.map((r) => r.shift_id ?? "")).size > 1;

  return (
    <PageContainer data-testid="attendance-history" className="space-y-5">
      <PageHeader
        title={th.title}
        description={th.description}
        actions={
          <Link href="/attendance">
            <Button variant="secondary">{th.todayLink}</Button>
          </Link>
        }
      />

      <Card className="overflow-hidden p-0 md:p-0">
        {records.length === 0 ? (
          <div className="p-4">
            <EmptyState title={th.noRecords} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.date}</th>
                  {showShift ? <th className="px-4 py-3 text-start font-medium">{tc.shift}</th> : null}
                  <th className="px-4 py-3 text-start font-medium">{th.checkIn}</th>
                  <th className="px-4 py-3 text-start font-medium">{th.checkOut}</th>
                  <th className="px-4 py-3 text-start font-medium">{th.workedMinutes}</th>
                  <th className="px-4 py-3 text-start font-medium">{th.late}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-line" data-testid="attendance-history-row">
                    <td className="px-4 py-3 tabular-nums">{r.attendance_date}</td>
                    {showShift ? (
                      <td className="px-4 py-3 text-muted">{(r.shift_id && shiftNames.get(r.shift_id)) || "—"}</td>
                    ) : null}
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_in_at, locale)}</td>
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_out_at, locale)}</td>
                    <td className="px-4 py-3 tabular-nums">{r.worked_minutes}</td>
                    <td className="px-4 py-3 tabular-nums">{r.late_minutes}</td>
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
    </PageContainer>
  );
}
