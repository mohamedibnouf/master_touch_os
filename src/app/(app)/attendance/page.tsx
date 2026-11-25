import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, History, LogIn, LogOut, MapPin, ShieldCheck, Users } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { attendanceStatusTone } from "@/lib/ui/operational-labels";
import { GeofencePunchButton } from "@/components/attendance/geofence-punch-button";
import { formatAttendanceDayTime } from "@/components/attendance/attendance-format";
import { checkInAction, checkOutAction } from "@/server/use-cases/attendance";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { addDaysYmd, todayInRiyadh } from "@/lib/time/riyadh";
import { buildTodayShiftRows, shiftsForWeekday, todayPunchState } from "@/modules/attendance/split-shifts";

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
  const { t, locale } = await getI18n();
  const ts = t.attendance.self;
  const tc = t.attendance.common;
  if (!ctx.employee) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader title={ts.noEmployeeTitle} description={tc.noEmployee} />
        <EmptyState title={tc.noEmployeeHint} />
      </PageContainer>
    );
  }

  const today = todayInRiyadh();
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);

  const yesterday = addDaysYmd(today, -1);
  const [recentRecords, recent, assignedShifts, geofenceReady] = await Promise.all([
    repo.listRecordsForEmployeeDates(ctx.organization.id, ctx.employee.id, yesterday, today),
    repo.listRecordsForEmployee(ctx.organization.id, ctx.employee.id, { limit: 14 }),
    repo.listShiftsForEmployeeOnDate(ctx.organization.id, ctx.employee.id, today),
    repo.geofenceSchemaReady(),
  ]);
  const workplaces = geofenceReady
    ? await repo.listEligibleWorkplacesForEmployee(ctx.organization.id, ctx.employee.id, today)
    : [];

  // 092: one row per shift per day (split shifts). Yesterday's still-open night shift counts too.
  const todayRecords = recentRecords.filter((r) => r.attendance_date === today);
  const carriedOpen = recentRecords.filter(
    (r) => r.attendance_date === yesterday && r.check_in_at && !r.check_out_at,
  );
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const shiftsToday = shiftsForWeekday(assignedShifts, todayDow);
  const punch = todayPunchState({ shiftsToday, todayRecords, carriedOpenRecords: carriedOpen });
  const shiftRows = buildTodayShiftRows(shiftsToday, todayRecords, carriedOpen);
  const shiftById = new Map(assignedShifts.map((s) => [s.id, s]));
  const todayRecord = punch.headlineRecord;
  const isSplit = shiftRows.length > 1;
  const recentShowsShift = new Set(recent.map((r) => r.shift_id ?? "")).size > 1;

  const canCheckIn = hasPermission(ctx, "attendance.check_in") && punch.canCheckIn;
  const canCheckOut = hasPermission(ctx, "attendance.check_out") && punch.canCheckOut;
  const canTeam = hasPermission(ctx, "attendance.view_team");
  const canHr = hasPermission(ctx, "attendance.view_all") || hasPermission(ctx, "attendance.manage");

  const fmt = (value: string | null) => formatAttendanceDayTime(value, locale);
  const statusTone = todayRecord ? attendanceStatusTone(todayRecord.attendance_status) : "neutral";
  const hint = punch.openRecord
    ? ts.checkedInHint
    : punch.betweenShifts
      ? ts.nextShiftHint
      : todayRecord?.check_in_at
        ? ts.doneHint
        : ts.notCheckedInHint;

  return (
    <PageContainer data-testid="attendance-dashboard" className="space-y-5">
      <PageHeader
        title={ts.title}
        description={format(ts.description, { date: today })}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href="/attendance/history">
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-history-link">
                <History className="size-4" aria-hidden />
                {ts.historyLink}
              </Button>
            </Link>
            {canTeam ? (
              <Link href="/attendance/team">
                <Button variant="secondary" className="w-full sm:w-auto">
                  <Users className="size-4" aria-hidden />
                  {ts.teamLink}
                </Button>
              </Link>
            ) : null}
            {canHr ? (
              <Link href="/hr/attendance">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {ts.manageLink}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="mt-surface-priority overflow-hidden" data-testid="attendance-today-card">
        <div className="px-4 py-5 md:px-6 md:py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted">{ts.todayStatus}</p>
              <p
                className={cn(
                  "mt-1 text-3xl font-semibold tracking-tight md:text-4xl",
                  statusTone === "success" && "text-success",
                  statusTone === "warning" && "text-warning",
                  statusTone === "danger" && "text-danger",
                  (statusTone === "neutral" || statusTone === "info") && "text-ink",
                )}
                data-testid="attendance-today-status"
              >
                {todayRecord ? attendanceStatusLabel(todayRecord.attendance_status, locale) : ts.notRecorded}
              </p>
              <p className="mt-2 max-w-xl text-sm text-muted">{hint}</p>
            </div>
            {todayRecord ? (
              <Badge tone={attendanceStatusTone(todayRecord.attendance_status)}>
                {attendanceStatusLabel(todayRecord.attendance_status, locale)}
              </Badge>
            ) : null}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-surface-muted px-4 py-3">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <LogIn className="size-3.5" aria-hidden />
                {ts.checkInTime}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {fmt(todayRecord?.check_in_at ?? null)}
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted px-4 py-3">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <LogOut className="size-3.5" aria-hidden />
                {ts.checkOutTime}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {fmt(todayRecord?.check_out_at ?? null)}
              </dd>
            </div>
          </dl>

          {isSplit ? (
            <ul className="mt-3 space-y-2" data-testid="attendance-today-shifts">
              {shiftRows.map((row) => {
                const sh = row.shift ?? (row.record?.shift_id ? shiftById.get(row.record.shift_id) : undefined);
                return (
                  <li
                    key={row.record?.id ?? row.shift?.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-ink">
                        {sh ? pickLocalized(locale, sh.name_ar, sh.name_en) : row.record?.attendance_date}
                      </span>
                      {sh ? (
                        <span className="ms-2 tabular-nums text-muted" dir="ltr">
                          {String(sh.start_time).slice(0, 5)} → {String(sh.end_time).slice(0, 5)}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="tabular-nums" dir="ltr">
                        {fmt(row.record?.check_in_at ?? null)} – {fmt(row.record?.check_out_at ?? null)}
                      </span>
                      <Badge tone={row.record ? attendanceStatusTone(row.record.attendance_status) : "neutral"}>
                        {row.state === "open"
                          ? ts.shiftOpen
                          : row.record
                            ? attendanceStatusLabel(row.record.attendance_status, locale)
                            : ts.shiftNotStarted}
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {todayRecords.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              {ts.worked} {format(tc.minutes, { n: punch.totals.worked })} · {ts.late}{" "}
              {format(tc.minutes, { n: punch.totals.late })} · {ts.earlyLeave}{" "}
              {format(tc.minutes, { n: punch.totals.early })}
            </p>
          ) : null}
          {punch.openRecord ? (
            <p className="mt-1 text-xs font-medium text-warning">{ts.checkoutPending}</p>
          ) : null}
        </div>

        {canCheckIn || canCheckOut ? (
          <div className="grid w-full gap-3 border-t border-line bg-surface-muted px-4 py-4 sm:grid-cols-2 md:px-6">
            {canCheckIn ? (
              geofenceReady ? (
                <GeofencePunchButton action="check_in" label={ts.checkIn} testId="attendance-check-in" size="large" />
              ) : (
                <ServerActionForm action={checkInAction} className="w-full">
                  <Button type="submit" className="min-h-12 w-full text-base md:min-h-12" data-testid="attendance-check-in">
                    <LogIn className="size-5" aria-hidden />
                    {ts.checkIn}
                  </Button>
                </ServerActionForm>
              )
            ) : null}
            {canCheckOut ? (
              geofenceReady ? (
                <GeofencePunchButton
                  action="check_out"
                  label={ts.checkOut}
                  testId="attendance-check-out"
                  variant="secondary"
                  size="large"
                />
              ) : (
                <ServerActionForm action={checkOutAction} className="w-full">
                  <Button
                    type="submit"
                    variant="secondary"
                    className="min-h-12 w-full text-base md:min-h-12"
                    data-testid="attendance-check-out"
                  >
                    <LogOut className="size-5" aria-hidden />
                    {ts.checkOut}
                  </Button>
                </ServerActionForm>
              )
            ) : null}
          </div>
        ) : null}
        <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs leading-relaxed text-muted md:px-6">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{ts.privacyNote}</span>
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Card data-testid="attendance-workplace-card">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <MapPin className="size-4 text-primary" aria-hidden />
            {ts.workplacesTitle}
          </h2>
          {workplaces.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {workplaces.map((place) => (
                <li key={place.id} className="rounded-lg bg-surface-muted px-3 py-2">
                  <p className="font-medium text-ink">{place.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {format(ts.allowedRadius, { n: place.allowed_radius_meters })}
                    {place.max_accuracy_meters ? ` · ${format(ts.maxAccuracy, { n: place.max_accuracy_meters })}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{ts.noWorkplace}</p>
          )}
          <p className="mt-3 text-xs text-muted">{ts.autoWorkplaceNote}</p>
          {todayRecord?.check_in_location_verified != null ? (
            <p className="mt-1 text-xs text-muted">
              {format(ts.checkInVerification, {
                result: todayRecord.check_in_location_verified ? ts.insideGeofence : ts.notVerified,
              })}
              {todayRecord.check_in_distance_meters != null
                ? ` · ${format(ts.distance, { n: todayRecord.check_in_distance_meters })}`
                : ""}
            </p>
          ) : null}
        </Card>

        <Card data-testid="attendance-shift-card">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Clock className="size-4 text-primary" aria-hidden />
            {assignedShifts.length > 1 ? ts.shiftsTitle : ts.shiftTitle}
          </h2>
          {assignedShifts.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {assignedShifts.map((shift) => (
                <li key={shift.id}>
                  <p className="font-medium text-ink">{pickLocalized(locale, shift.name_ar, shift.name_en)}</p>
                  <p className="mt-1 text-muted">
                    <span className="tabular-nums" dir="ltr">
                      {String(shift.start_time).slice(0, 5)} → {String(shift.end_time).slice(0, 5)}
                    </span>
                    {shift.crosses_midnight ? ` ${ts.crossesMidnight}` : ""} ·{" "}
                    {format(ts.breakMinutes, { n: shift.break_minutes })}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={ts.noShift} />
          )}
        </Card>
      </div>

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{ts.recentTitle}</div>
        {recent.length === 0 ? (
          <div className="p-4">
            <EmptyState title={ts.noRecords} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.date}</th>
                  {recentShowsShift ? <th className="px-4 py-3 text-start font-medium">{tc.shift}</th> : null}
                  <th className="px-4 py-3 text-start font-medium">{tc.checkIn}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.checkOut}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-3 tabular-nums">{r.attendance_date}</td>
                    {recentShowsShift ? (
                      <td className="px-4 py-3 text-muted">
                        {(() => {
                          const sh = r.shift_id ? shiftById.get(r.shift_id) : undefined;
                          return sh ? pickLocalized(locale, sh.name_ar, sh.name_en) : "—";
                        })()}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">{fmt(r.check_in_at)}</td>
                    <td className="px-4 py-3">{fmt(r.check_out_at)}</td>
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
