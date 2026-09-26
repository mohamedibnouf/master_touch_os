import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { attendanceStatusLabel } from "@/lib/hr/labels";
import { formatEvidenceCoordinates } from "@/modules/attendance/geofence";
import { reconcileAttendanceAction } from "@/server/use-cases/attendance";

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

  const sp = (await searchParams) ?? {};
  const today = new Date().toISOString().slice(0, 10);
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

  return (
    <div data-testid="attendance-hr-dashboard">
      <PageHeader
        title="إدارة الحضور"
        description="لوحة الموارد البشرية للحضور اليومي"
        actions={
          <div className="flex flex-col gap-2 sm:flex-row">
            {canPolicies ? (
              <Link href="/hr/attendance/policies">
                <Button variant="secondary" className="w-full sm:w-auto">
                  السياسات
                </Button>
              </Link>
            ) : null}
            {canShifts ? (
              <Link href="/hr/attendance/shifts">
                <Button variant="secondary" className="w-full sm:w-auto">
                  الورديات
                </Button>
              </Link>
            ) : null}
            {canShifts ? (
              <Link href="/hr/attendance/assignments">
                <Button variant="secondary" className="w-full sm:w-auto">
                  التعيينات
                </Button>
              </Link>
            ) : null}
            {canAdjust ? (
              <Link href="/hr/attendance/adjustments">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-adjustments-link">
                  التعديلات
                </Button>
              </Link>
            ) : null}
            {hasPermission(ctx, "attendance.manage_locations") ? (
              <Link href="/hr/attendance/locations">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="attendance-locations-link">
                  مواقع العمل
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card>
          <p className="text-sm text-muted">حاضر</p>
          <p className="mt-1 text-2xl font-semibold text-navy" data-testid="attendance-hr-present-count">
            {present}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">متأخر</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{late}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">غائب</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{absent}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">بدون انصراف</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{missing}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">في إجازة</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{onLeave}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">رفض النطاق</p>
          <p className="mt-1 text-2xl font-semibold text-navy" data-testid="attendance-hr-geofence-reject-count">
            {rejectedToday}
          </p>
        </Card>
      </div>

      <Card className="mb-6" data-testid="attendance-hr-filters">
        <h2 className="mb-3 font-semibold text-navy">تصفية</h2>
        <form method="get" className="grid gap-3 sm:grid-cols-3">
          <Field label="التاريخ">
            <Input type="date" name="date" defaultValue={date} />
          </Field>
          <Field label="الحالة">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">الكل</option>
              <option value="present">حاضر</option>
              <option value="late">متأخر</option>
              <option value="absent">غائب</option>
              <option value="partial">جزئي</option>
              <option value="on_leave">إجازة</option>
              <option value="missing_checkout">بدون انصراف</option>
              <option value="off_day">راحة</option>
              <option value="holiday">عطلة</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full sm:w-auto">
              تطبيق
            </Button>
          </div>
        </form>
      </Card>

      {canManage ? (
        <Card className="mb-6" data-testid="attendance-reconcile-form">
          <h2 className="mb-3 font-semibold text-navy">تسوية يوم</h2>
          <form action={reconcileAttendanceAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ التسوية">
              <Input type="date" name="attendanceDate" defaultValue={date} required />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full sm:w-auto">
                تشغيل التسوية
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {geofenceReady && attempts.length > 0 ? (
        <Card className="mb-6 overflow-x-auto p-0" data-testid="attendance-location-attempts">
          <div className="border-b border-line px-4 py-3 font-semibold text-navy">محاولات الموقع (مرفوضة/مقبولة)</div>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">الإجراء</th>
                <th className="px-4 py-3 text-right">النتيجة</th>
                <th className="px-4 py-3 text-right">الموقع</th>
                <th className="px-4 py-3 text-right">المسافة</th>
                <th className="px-4 py-3 text-right">الدقة</th>
                <th className="px-4 py-3 text-right">الوقت</th>
                {canEvidence ? <th className="px-4 py-3 text-right">الإحداثيات</th> : null}
              </tr>
            </thead>
            <tbody>
              {attempts.slice(0, 30).map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-3">{names.get(a.employee_id) ?? a.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{a.action === "CHECK_IN" ? "دخول" : "انصراف"}</td>
                  <td className="px-4 py-3">{a.result}</td>
                  <td className="px-4 py-3">
                    {a.workplace_location_id ? (workplaceNames.get(a.workplace_location_id) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3">{a.distance_meters ?? "—"}</td>
                  <td className="px-4 py-3">{a.accuracy_meters ?? "—"}</td>
                  <td className="px-4 py-3">{new Date(a.created_at).toLocaleString("ar-SA")}</td>
                  {canEvidence ? (
                    <td className="px-4 py-3 dir-ltr text-left text-xs">
                      {formatEvidenceCoordinates(a.latitude, a.longitude)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">سجلات {date}</div>
        {records.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد سجلات مطابقة." />
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">دخول</th>
                <th className="px-4 py-3 text-right">انصراف</th>
                <th className="px-4 py-3 text-right">عمل (د)</th>
                <th className="px-4 py-3 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-line" data-testid="attendance-hr-row">
                  <td className="px-4 py-3">{names.get(r.employee_id) ?? r.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.check_out_at
                      ? new Date(r.check_out_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{r.worked_minutes}</td>
                  <td className="px-4 py-3">
                    <Badge>{attendanceStatusLabel(r.attendance_status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
