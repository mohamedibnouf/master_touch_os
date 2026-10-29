import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { adjustAttendanceRecordAction } from "@/server/use-cases/attendance";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { formatAttendanceDateTime } from "@/components/attendance/attendance-format";
import { pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { isoToRiyadhLocalInput, todayInRiyadh } from "@/lib/time/riyadh";
import { AttendanceAdjustFields } from "@/components/attendance/attendance-adjust-fields";

const ADJUST_STATUSES = [
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

export default async function HrAttendanceAdjustmentsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.adjust") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/hr/attendance");
  }
  const canAdjust = hasPermission(ctx, "attendance.adjust");
  if (canAdjust) authorize(ctx, "attendance.adjust");
  const { t, locale } = await getI18n();
  const tj = t.attendance.adjustments;
  const tc = t.attendance.common;

  const today = todayInRiyadh();
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [adjustments, todayRecords] = await Promise.all([
    repo.listAdjustments(ctx.organization.id, 100),
    repo.listRecordsForDate(ctx.organization.id, today),
  ]);
  const names = await employeeNameMap(
    supabase,
    [...adjustments.map((a) => a.employee_id), ...todayRecords.map((r) => r.employee_id)],
    locale,
  );

  return (
    <PageContainer data-testid="attendance-adjustments" className="space-y-5">
      <PageHeader title={tj.title} description={tj.description} />

      {canAdjust ? (
        <Card data-testid="attendance-adjust-form">
          <h2 className="mb-4 text-sm font-semibold text-ink">{tj.formTitle}</h2>
          <ServerActionForm action={adjustAttendanceRecordAction} className="grid gap-3 md:grid-cols-2">
            <AttendanceAdjustFields
              records={todayRecords.map((r) => ({
                id: r.id,
                label: `${names.get(r.employee_id) ?? r.employee_id.slice(0, 8)} · ${r.attendance_date} · ${attendanceStatusLabel(r.attendance_status, locale)}`,
                checkInLocal: isoToRiyadhLocalInput(r.check_in_at),
                checkOutLocal: isoToRiyadhLocalInput(r.check_out_at),
              }))}
              labels={{
                record: tj.todayRecord,
                chooseRecord: tj.chooseRecord,
                checkIn: tj.checkInLocal,
                checkOut: tj.checkOutLocal,
                timeZoneHint: tj.riyadhTimeHint,
              }}
            />
            <Field label={tj.statusOptional}>
              <Select name="attendanceStatus" defaultValue="">
                <option value="">{tj.autoRecalculate}</option>
                {ADJUST_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {attendanceStatusLabel(value, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tj.notes}>
              <Input name="notes" />
            </Field>
            <div className="md:col-span-2">
              <Field label={tj.reason} required>
                <Input name="reason" required minLength={3} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" className="w-full sm:w-auto">
                {tj.save}
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tj.logTitle}</div>
        {adjustments.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tj.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                  <th className="px-4 py-3 text-start font-medium">{tj.reasonColumn}</th>
                  <th className="px-4 py-3 text-start font-medium">{tc.time}</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-t border-line" data-testid="attendance-adjustment-row">
                    <td className="px-4 py-3 font-medium text-ink">
                      {names.get(a.employee_id) ?? a.employee_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">{a.reason}</td>
                    <td className="px-4 py-3">{formatAttendanceDateTime(a.adjusted_at, locale)}</td>
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
