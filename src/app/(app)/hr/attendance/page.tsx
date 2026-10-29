import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, StatCard, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { attendanceStatusTone } from "@/lib/ui/operational-labels";
import { formatEvidenceCoordinates } from "@/modules/attendance/geofence";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { reconcileAttendanceAction } from "@/server/use-cases/attendance";
import { formatAttendanceDateTime, formatAttendanceTime } from "@/components/attendance/attendance-format";
import { format, pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { todayInRiyadh } from "@/lib/time/riyadh";

const STATUS_FILTERS = [
  "present",
  "late",
  "absent",
  "partial",
  "on_leave",
  "missing_checkout",
  "off_day",
  "holiday",
] as const;

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

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string; status?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.view_all") && !hasPermission(ctx, "attendance.manage")) {
    redirect("/attendance");
  }
  const { t, locale } = await getI18n();
  const ta = t.attendance.admin;
  const tc = t.attendance.common;

  const sp = (await searchParams) ?? {};
  const today = todayInRiyadh();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const status = sp.status?.trim() || undefined;

  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const records = await repo.listRecordsForDate(ctx.organization.id, date, status);
  const canEvidence = hasPermission(ctx, "attendance.view_location_evidence");
  const geofenceReady = await repo.geofenceSchemaReady();
  const attempts = geofenceReady
    ? await repo.listLocationAttempts(ctx.organization.id, { includeCoordinates: canEvidence, limit: 50 })
    : [];
  const names = await employeeNameMap(
    supabase,
    [...records.map((r) => r.employee_id), ...attempts.map((a) => a.employee_id)],
    locale,
  );

  const present = records.filter((r) => ["present", "late", "partial"].includes(r.attendance_status)).length;
  const late = records.filter((r) => r.attendance_status === "late").length;
  const absent = records.filter((r) => r.attendance_status === "absent").length;
  const missing = records.filter((r) => r.attendance_status === "missing_checkout").length;
  const onLeave = records.filter((r) => r.attendance_status === "on_leave").length;
  const canManage = hasPermission(ctx, "attendance.manage");
  const canPolicies = hasPermission(ctx, "attendance.manage_policies");
  const canShifts = hasPermission(ctx, "attendance.manage_shifts");
  const canAdjust = hasPermission(ctx, "attendance.adjust");
  const workplaces = geofenceReady ? await repo.listWorkplaceDirectory(ctx.organization.id) : [];
  const workplaceNames = new Map(workplaces.map((w) => [w.id, w.name]));
  const rejectedToday = attempts.filter(
    (a) => a.created_at.slice(0, 10) === date && a.result !== "ACCEPTED",
  ).length;
  const attemptLabel = (result: string) =>
    (ta.attemptResults as Record<string, string>)[result] ?? result;

  return (
    <PageContainer data-testid="attendance-hr-dashboard" className="space-y-5">
      <PageHeader
        title={ta.title}
        description={ta.description}
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            {canPolicies ? (
              <Link href="/hr/attendance/policies">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {ta.policiesLink}
                </Button>
              </Link>
            ) : null}
            {canShifts ? (
              <Link href="/hr/attendance/shifts">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {ta.shiftsLink}
                </Button>
              </Link>
            ) : null}
            {canShifts ? (
              <Link href="/hr/attendance/assignments">
                <Button variant="secondary" className="w-full sm:w-auto">
                  {ta.assignmentsLink}
                </Button>
              </Link>
            ) : null}
            {canAdjust ? (
              <Link href="/hr/attendance/adjustments">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-adjustments-link">
                  {ta.adjustmentsLink}
                </Button>
              </Link>
            ) : null}
            {hasPermission(ctx, "attendance.manage_locations") ? (
              <Link href="/hr/attendance/locations">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-locations-link">
                  {ta.locationsLink}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          label={ta.present}
          tone="success"
          value={<span data-testid="attendance-hr-present-count">{present}</span>}
        />
        <StatCard label={ta.late} tone={late > 0 ? "warning" : "neutral"} value={late} />
        <StatCard label={ta.absent} tone={absent > 0 ? "danger" : "neutral"} value={absent} />
        <StatCard label={ta.missingCheckout} tone={missing > 0 ? "warning" : "neutral"} value={missing} />
        <StatCard label={ta.onLeave} value={onLeave} />
        <StatCard
          label={ta.geofenceRejected}
          tone={rejectedToday > 0 ? "danger" : "neutral"}
          value={<span data-testid="attendance-hr-geofence-reject-count">{rejectedToday}</span>}
        />
      </div>

      <div className={canManage ? "grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : undefined}>
        <Card data-testid="attendance-hr-filters">
          <h2 className="mb-3 text-sm font-semibold text-ink">{ta.filtersTitle}</h2>
          <form method="get" className="grid gap-3 sm:grid-cols-3">
            <Field label={tc.date}>
              <Input type="date" name="date" defaultValue={date} />
            </Field>
            <Field label={tc.status}>
              <Select name="status" defaultValue={status ?? ""}>
                <option value="">{tc.all}</option>
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {attendanceStatusLabel(value, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full sm:w-auto">
                {ta.apply}
              </Button>
            </div>
          </form>
        </Card>

        {canManage ? (
          <Card data-testid="attendance-reconcile-form">
            <h2 className="mb-3 text-sm font-semibold text-ink">{ta.reconcileTitle}</h2>
            <ServerActionForm action={reconcileAttendanceAction} className="grid gap-3">
              <Field label={ta.reconcileDate}>
                <Input type="date" name="attendanceDate" defaultValue={date} required />
              </Field>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                  {ta.reconcileRun}
                </Button>
              </div>
            </ServerActionForm>
          </Card>
        ) : null}
      </div>

      {geofenceReady && attempts.length > 0 ? (
        <Card className="overflow-hidden p-0 md:p-0" data-testid="attendance-location-attempts">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{ta.attemptsTitle}</div>
          <TableScroll>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.action}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.result}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.location}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.distance}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.accuracy}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.time}</th>
                  {canEvidence ? <th className="px-4 py-3 text-start font-medium">{ta.coordinates}</th> : null}
                </tr>
              </thead>
              <tbody>
                {attempts.slice(0, 30).map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="px-4 py-3">{names.get(a.employee_id) ?? a.employee_id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{a.action === "CHECK_IN" ? ta.actionCheckIn : ta.actionCheckOut}</td>
                    <td className="px-4 py-3">
                      <Badge tone={a.result === "ACCEPTED" ? "success" : "danger"} title={a.result}>
                        {attemptLabel(a.result)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {a.workplace_location_id ? (workplaceNames.get(a.workplace_location_id) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {a.distance_meters != null ? format(tc.meters, { n: a.distance_meters }) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {a.accuracy_meters != null ? format(tc.meters, { n: a.accuracy_meters }) : "—"}
                    </td>
                    <td className="px-4 py-3">{formatAttendanceDateTime(a.created_at, locale)}</td>
                    {canEvidence ? (
                      <td className="px-4 py-3 dir-ltr text-left text-xs">
                        {formatEvidenceCoordinates(a.latitude, a.longitude, locale)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
          {format(ta.recordsTitle, { date })}
        </div>
        {records.length === 0 ? (
          <div className="p-4">
            <EmptyState title={ta.noRecords} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.checkIn}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.checkOut}</th>
                  <th className="px-4 py-3 text-start font-medium">{ta.workedMinutes}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-line" data-testid="attendance-hr-row">
                    <td className="px-4 py-3 font-medium text-ink">
                      {names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_in_at, locale)}</td>
                    <td className="px-4 py-3">{formatAttendanceTime(r.check_out_at, locale)}</td>
                    <td className="px-4 py-3 tabular-nums">{r.worked_minutes}</td>
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
