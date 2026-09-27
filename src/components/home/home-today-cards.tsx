import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
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

  const canViewAttendance = Boolean(ctx.employee && hasPermission(ctx, "attendance.view_self"));
  const canViewLeave = Boolean(ctx.employee && hasPermission(ctx, "leave.view_self"));

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

  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2">
      {hasPermission(ctx, "attendance.view_self") ? (
        <Card data-testid="home-attendance">
          <p className="text-sm text-muted">الحضور · {todayYmd}</p>
          <p className="mt-1 text-xl font-semibold text-navy">
            {attendance ? attendanceStatusLabel(attendance.attendance_status) : "لم يُسجَّل بعد"}
          </p>
          {shift ? <p className="mt-1 text-xs text-muted">{shift.name_ar}</p> : null}
          {attendance?.check_in_at && !attendance.check_out_at ? (
            <Badge tone="warning" className="mt-2">
              لم يُسجَّل الانصراف
            </Badge>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
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
            <Link href="/attendance" className="text-sm text-navy underline">
              صفحة الحضور
            </Link>
          </div>
        </Card>
      ) : null}

      {hasPermission(ctx, "leave.view_self") ? (
        <Card data-testid="home-leave">
          <p className="text-sm text-muted">الإجازات</p>
          <p className="mt-1 text-xl font-semibold text-navy">
            {leaveAvailable == null ? "—" : `${leaveAvailable} يوم متاح`}
          </p>
          <p className="mt-1 text-xs text-muted">{leavePendingCount} طلب قيد المعالجة</p>
          <Link href="/leave" className="mt-3 inline-block text-sm text-navy underline">
            إجازاتي
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
