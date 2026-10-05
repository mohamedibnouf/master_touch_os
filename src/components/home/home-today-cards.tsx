import Link from "next/link";
import { CalendarDays, Clock } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import { homeShowsSelfServiceCard } from "@/lib/home/self-service";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { GeofencePunchButton } from "@/components/attendance/geofence-punch-button";
import { checkInAction, checkOutAction } from "@/server/use-cases/attendance";
import { ServerActionForm } from "@/components/forms/server-action-form";
import type { AuthContext } from "@/types/models";

export async function HomeTodayCards({ ctx }: { ctx: AuthContext }) {
  const supabase = await createServerSupabaseClient();
  const todayYmd = riyadhTodayYmd();
  const attendanceToday = new Date().toISOString().slice(0, 10);
  const attRepo = new AttendanceRepository(supabase);

  const canViewAttendance = homeShowsSelfServiceCard({
    hasEmployeeRow: Boolean(ctx.employee),
    permissionGranted: hasPermission(ctx, "attendance.view_self"),
  });
  const canViewLeave = homeShowsSelfServiceCard({
    hasEmployeeRow: Boolean(ctx.employee),
    permissionGranted: hasPermission(ctx, "leave.view_self"),
  });

  const [record, assignment, geofenceReady, leavePack] = await Promise.all([
    canViewAttendance && ctx.employee
      ? attRepo.getRecordForDate(ctx.organization.id, ctx.employee.id, attendanceToday)
      : Promise.resolve(null),
    canViewAttendance && ctx.employee
      ? attRepo.getActiveAssignment(ctx.organization.id, ctx.employee.id, attendanceToday)
      : Promise.resolve(null),
    ctx.employee ? attRepo.geofenceSchemaReady() : Promise.resolve(false),
    canViewLeave && ctx.employee
      ? Promise.all([
          new LeaveRepository(supabase).listBalances(ctx.organization.id, ctx.employee.id, new Date().getFullYear()),
          new LeaveRepository(supabase).listRequestsForEmployee(ctx.organization.id, ctx.employee.id),
        ])
      : Promise.resolve(null),
  ]);

  const shift =
    assignment && ctx.employee
      ? await attRepo.getShift(ctx.organization.id, assignment.shift_id)
      : null;

  const attendance = record;
  const leaveAvailable = leavePack
    ? leavePack[0].reduce((sum, b) => sum + Number(b.available_days ?? 0), 0)
    : null;
  const leavePendingCount = leavePack ? leavePack[1].filter((r) => r.status === "submitted").length : 0;

  const canCheckIn = hasPermission(ctx, "attendance.check_in") && ctx.employee && !attendance?.check_in_at;
  const canCheckOut =
    hasPermission(ctx, "attendance.check_out") &&
    ctx.employee &&
    Boolean(attendance?.check_in_at) &&
    !attendance?.check_out_at;

  const showAttendance = canViewAttendance;
  const showLeave = canViewLeave;
  if (!showAttendance && !showLeave) return null;

  const checkedIn = Boolean(attendance?.check_in_at);
  const statusTone = !attendance ? "neutral" : attendance.check_out_at ? "success" : checkedIn ? "warning" : "info";

  return (
    <div className="flex h-full flex-col gap-3">
      {showAttendance ? (
        <section data-testid="home-attendance" className="mt-surface-priority flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative border-b border-line px-4 py-4 md:px-5">
            <div className="flex items-start gap-3">
              <span className="mt-icon-well">
                <Clock className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted">الحضور اليوم · {todayYmd}</p>
                <p className="mt-1 text-xl font-semibold leading-snug text-ink">
                  {attendance ? attendanceStatusLabel(attendance.attendance_status) : "لم يُسجَّل بعد"}
                </p>
                {shift ? <p className="mt-1 text-sm text-muted">{shift.name_ar}</p> : null}
                {attendance?.check_in_at && !attendance.check_out_at ? (
                  <span className="mt-2 inline-block">
                    <Badge tone={statusTone}>لم يُسجَّل الانصراف</Badge>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 bg-white px-4 py-3 md:px-5">
            {canCheckIn ? (
              geofenceReady ? (
                <GeofencePunchButton action="check_in" label="تسجيل الحضور" testId="home-check-in" />
              ) : (
                <ServerActionForm action={checkInAction}>
                  <Button type="submit" className="w-full" data-testid="home-check-in">
                    تسجيل الحضور
                  </Button>
                </ServerActionForm>
              )
            ) : null}
            {canCheckOut ? (
              geofenceReady ? (
                <GeofencePunchButton
                  action="check_out"
                  label="تسجيل الانصراف"
                  testId="home-check-out"
                  variant="secondary"
                />
              ) : (
                <ServerActionForm action={checkOutAction}>
                  <Button type="submit" variant="secondary" className="w-full" data-testid="home-check-out">
                    تسجيل الانصراف
                  </Button>
                </ServerActionForm>
              )
            ) : null}
            {!canCheckIn && !canCheckOut ? (
              <p className="text-sm text-muted">لا يوجد إجراء حضور متاح حالياً.</p>
            ) : null}
            <Link href="/attendance" className="text-xs font-medium text-primary duration-150 hover:underline">
              صفحة الحضور
            </Link>
          </div>
        </section>
      ) : null}

      {showLeave ? (
        <section
          data-testid="home-leave"
          className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-surface)] border border-line bg-surface-muted px-3 py-2.5"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-sm text-ink">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
            <span className="font-medium">الإجازات</span>
            <span className="font-semibold tabular-nums">
              {leaveAvailable == null ? "—" : `${leaveAvailable} يوم`}
            </span>
            <span className="text-muted">· {leavePendingCount} قيد المعالجة</span>
          </span>
          <Link href="/leave" className="text-xs font-medium text-primary duration-150 hover:underline">
            إجازاتي
          </Link>
        </section>
      ) : null}
    </div>
  );
}
