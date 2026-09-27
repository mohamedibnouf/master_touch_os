import { redirect } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { adjustAttendanceRecordAction } from "@/server/use-cases/attendance";

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

export default async function HrAttendanceAdjustmentsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "attendance.adjust") && !hasPermission(ctx, "attendance.view_all")) {
    redirect("/hr/attendance");
  }
  const canAdjust = hasPermission(ctx, "attendance.adjust");
  if (canAdjust) authorize(ctx, "attendance.adjust");

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [adjustments, todayRecords] = await Promise.all([
    repo.listAdjustments(ctx.organization.id, 100),
    repo.listRecordsForDate(ctx.organization.id, today),
  ]);
  const names = await employeeNameMap(supabase, [
    ...adjustments.map((a) => a.employee_id),
    ...todayRecords.map((r) => r.employee_id),
  ]);

  return (
    <div data-testid="attendance-adjustments">
      <PageHeader title="تعديلات الحضور" description="سجل تعديلات HR غير القابل للتغيير" />

      {canAdjust ? (
        <Card className="mb-6" data-testid="attendance-adjust-form">
          <h2 className="mb-4 font-semibold text-navy">تعديل سجل</h2>
          <ServerActionForm action={adjustAttendanceRecordAction} className="grid gap-3">
            <Field label="سجل اليوم">
              <Select name="recordId" required>
                <option value="">اختر سجلًا</option>
                {todayRecords.map((r) => (
                  <option key={r.id} value={r.id}>
                    {names.get(r.employee_id) ?? r.employee_id.slice(0, 8)} · {r.attendance_date} ·{" "}
                    {r.attendance_status}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="وقت الدخول (محلي)">
              <Input type="datetime-local" name="checkInAt" />
            </Field>
            <Field label="وقت الانصراف (محلي)">
              <Input type="datetime-local" name="checkOutAt" />
            </Field>
            <Field label="الحالة (اختياري)">
              <Select name="attendanceStatus" defaultValue="">
                <option value="">إعادة حساب تلقائي</option>
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
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <Field label="سبب التعديل">
              <Input name="reason" required minLength={3} />
            </Field>
            <Button type="submit">حفظ التعديل</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">سجل التعديلات</div>
        {adjustments.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد تعديلات بعد." />
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">السبب</th>
                <th className="px-4 py-3 text-right">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id} className="border-t border-line" data-testid="attendance-adjustment-row">
                  <td className="px-4 py-3">{names.get(a.employee_id) ?? a.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{a.reason}</td>
                  <td className="px-4 py-3">
                    {new Date(a.adjusted_at).toLocaleString("ar-SA", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
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
