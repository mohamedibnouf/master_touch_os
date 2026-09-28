import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { GeofencePunchButton } from "@/components/attendance/geofence-punch-button";
import { checkInAction, checkOutAction } from "@/server/use-cases/attendance";
import { ServerActionForm } from "@/components/forms/server-action-form";

function formatTs(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ar-SA", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  } catch {
    return value;
  }
}

export default async function AttendanceDashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (
    !hasPermission(ctx, "attendance.view_self") &&
    !hasPermission(ctx, "attendance.check_in") &&
    !hasPermission(ctx, "attendance.view_all")
  ) {
    redirect("/");
  }
  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title="الحضور" description="لا يوجد سجل موظف مرتبط بحسابك." />
        <EmptyState title="تواصل مع الموارد البشرية لربط حسابك بملف موظف." />
      </PageContainer>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);

  const [todayRecord, recent, assignment, geofenceReady] = await Promise.all([
    repo.getRecordForDate(ctx.organization.id, ctx.employee.id, today),
    repo.listRecordsForEmployee(ctx.organization.id, ctx.employee.id, { limit: 7 }),
    repo.getActiveAssignment(ctx.organization.id, ctx.employee.id, today),
    repo.geofenceSchemaReady(),
  ]);
  const shift = assignment
    ? await repo.getShift(ctx.organization.id, assignment.shift_id)
    : null;
  const workplaces = geofenceReady
    ? await repo.listEligibleWorkplacesForEmployee(ctx.organization.id, ctx.employee.id, today)
    : [];

  const canCheckIn = hasPermission(ctx, "attendance.check_in") && !todayRecord?.check_in_at;
  const canCheckOut =
    hasPermission(ctx, "attendance.check_out") &&
    Boolean(todayRecord?.check_in_at) &&
    !todayRecord?.check_out_at;
  const canTeam = hasPermission(ctx, "attendance.view_team");
  const canHr = hasPermission(ctx, "attendance.view_all") || hasPermission(ctx, "attendance.manage");

  return (
    <PageContainer data-testid="attendance-dashboard" className="space-y-5">
      <PageHeader
        title="حضوري"
        description={`حالة اليوم ${today}`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href="/attendance/history">
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-history-link">
                السجل
              </Button>
            </Link>
            {canTeam ? (
              <Link href="/attendance/team">
                <Button variant="secondary" className="w-full sm:w-auto">
                  حضور الفريق
                </Button>
              </Link>
            ) : null}
            {canHr ? (
              <Link href="/hr/attendance">
                <Button variant="secondary" className="w-full sm:w-auto">
                  إدارة الحضور
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="mt-surface-priority mb-6 overflow-hidden" data-testid="attendance-today-card">
        <div className="bg-navy px-4 py-4 text-white md:px-5">
          <p className="text-xs font-medium text-white/70">حالة اليوم</p>
          <p className="mt-1 text-2xl font-semibold" data-testid="attendance-today-status">
            {todayRecord ? attendanceStatusLabel(todayRecord.attendance_status) : "لم يُسجَّل بعد"}
          </p>
          <p className="mt-2 text-sm text-white/70">
            دخول: {formatTs(todayRecord?.check_in_at ?? null)} · خروج:{" "}
            {formatTs(todayRecord?.check_out_at ?? null)}
          </p>
          {todayRecord ? (
            <p className="mt-1 text-xs text-white/60">
              عمل {todayRecord.worked_minutes} د · تأخير {todayRecord.late_minutes} د · انصراف مبكر{" "}
              {todayRecord.early_leave_minutes} د
            </p>
          ) : null}
          {todayRecord?.check_in_at && !todayRecord.check_out_at ? (
            <p className="mt-1 text-xs text-white/80">لم يُسجَّل الانصراف بعد.</p>
          ) : null}
          {todayRecord ? (
            <span className="mt-2 inline-block">
              <Badge tone={todayRecord.attendance_status === "present" ? "success" : "warning"}>
                {attendanceStatusLabel(todayRecord.attendance_status)}
              </Badge>
            </span>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 bg-white px-4 py-3 sm:flex-row md:px-5">
          {canCheckIn ? (
            geofenceReady ? (
              <GeofencePunchButton action="check_in" label="تسجيل الحضور" testId="attendance-check-in" />
            ) : (
              <ServerActionForm action={checkInAction} className="w-full sm:w-auto">
                <Button type="submit" className="w-full sm:w-auto" data-testid="attendance-check-in">
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
                testId="attendance-check-out"
                variant="secondary"
              />
            ) : (
              <ServerActionForm action={checkOutAction} className="w-full sm:w-auto">
                <Button type="submit" variant="secondary" className="w-full sm:w-auto" data-testid="attendance-check-out">
                  تسجيل الانصراف
                </Button>
              </ServerActionForm>
            )
          ) : null}
        </div>
        <p className="mt-3 px-4 pb-3 text-xs text-muted md:px-5">
          يستخدم النظام موقعك فقط للتحقق من وجودك داخل نطاق موقع العمل عند تسجيل الحضور أو الانصراف. لا يتم تتبعك بشكل
          مستمر. تحديد الموقع عبر المتصفح دليل تشغيلي وليس ضماناً ضد تزييف GPS.
        </p>
      </section>

      <Card className="mb-6" data-testid="attendance-workplace-card">
        <h2 className="mb-2 font-semibold text-navy">مواقع الحضور المسموحة</h2>
        {workplaces.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {workplaces.map((place) => (
              <li key={place.id}>
                <p className="font-medium text-navy">{place.name}</p>
                <p className="mt-0.5 text-muted">
                  النطاق المسموح {place.allowed_radius_meters} م
                  {place.max_accuracy_meters ? ` · أقصى خطأ مسموح ≤ ${place.max_accuracy_meters} م` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">لم يتم تحديد موقع عمل معتمد لهذا الموظف.</p>
        )}
        <p className="mt-3 text-xs text-muted">
          لا تحتاج لاختيار الموقع. عند التسجيل يحدد الخادم أقرب موقع مصرّح داخل النطاق.
        </p>
        {todayRecord?.check_in_location_verified != null ? (
          <p className="mt-1 text-xs text-muted">
            تحقق الدخول: {todayRecord.check_in_location_verified ? "داخل النطاق" : "غير متحقَّق"}
            {todayRecord.check_in_distance_meters != null ? ` · المسافة ${todayRecord.check_in_distance_meters} م` : ""}
          </p>
        ) : null}
      </Card>

      <Card className="mb-6" data-testid="attendance-shift-card">
        <h2 className="mb-2 font-semibold text-navy">الوردية الحالية</h2>
        {shift ? (
          <div className="text-sm">
            <p className="font-medium text-navy">{shift.name_ar}</p>
            <p className="mt-1 text-muted">
              {String(shift.start_time).slice(0, 5)} → {String(shift.end_time).slice(0, 5)}
              {shift.crosses_midnight ? " (تجاوز منتصف الليل)" : ""} · استراحة {shift.break_minutes} د
            </p>
          </div>
        ) : (
          <EmptyState title="لا توجد وردية مُعيَّنة. تواصل مع الموارد البشرية." />
        )}
      </Card>

      <Card className="mb-6 overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">آخر الأيام</div>
        {recent.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا يوجد سجل حضور بعد." />
          </div>
        ) : (
          <TableScroll>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">التاريخ</th>
                <th className="px-4 py-3 text-right">الدخول</th>
                <th className="px-4 py-3 text-right">الانصراف</th>
                <th className="px-4 py-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3">{r.attendance_date}</td>
                  <td className="px-4 py-3">{formatTs(r.check_in_at)}</td>
                  <td className="px-4 py-3">{formatTs(r.check_out_at)}</td>
                  <td className="px-4 py-3">
                    <Badge>{attendanceStatusLabel(r.attendance_status)}</Badge>
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
