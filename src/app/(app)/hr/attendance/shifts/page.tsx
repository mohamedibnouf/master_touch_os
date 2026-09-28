import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertAttendanceShiftAction } from "@/server/use-cases/attendance";

export default async function HrAttendanceShiftsPage() {
  authorize(await getAuthContext(), "attendance.manage_shifts");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [shifts, policies] = await Promise.all([
    repo.listShifts(ctx.organization.id),
    repo.listPolicies(ctx.organization.id, true),
  ]);
  const policyMap = new Map(policies.map((p) => [p.id, p.name_ar]));

  return (
    <PageContainer data-testid="attendance-shifts" className="space-y-5">
      <PageHeader title="الورديات" description="تعريف ورديات العمل وربطها بالسياسات" />

      <Card className="mb-6" data-testid="attendance-shift-form">
        <h2 className="mb-4 font-semibold text-navy">إضافة / تحديث وردية</h2>
        <ServerActionForm action={upsertAttendanceShiftAction} className="grid gap-3">
          <Field label="السياسة">
            <Select name="policy_id" required>
              <option value="">اختر</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الرمز">
            <Input name="code" required placeholder="STD_DAY" />
          </Field>
          <Field label="الاسم بالعربية">
            <Input name="name_ar" required />
          </Field>
          <Field label="Name (EN)">
            <Input name="name_en" required />
          </Field>
          <Field label="بداية (HH:MM)">
            <Input name="start_time" required placeholder="08:00" defaultValue="08:00" />
          </Field>
          <Field label="نهاية (HH:MM)">
            <Input name="end_time" required placeholder="17:00" defaultValue="17:00" />
          </Field>
          <Field label="استراحة (دقائق)">
            <Input name="break_minutes" type="number" defaultValue={60} />
          </Field>
          <Field label="أيام العمل (0=أحد … 6=سبت)">
            <Input name="working_days" defaultValue="0,1,2,3,4" required />
          </Field>
          <Field label="تجاوز منتصف الليل؟">
            <Select name="crosses_midnight" defaultValue="false">
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </Select>
          </Field>
          <Field label="نشط؟">
            <Select name="is_active" defaultValue="true">
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Button type="submit">حفظ الوردية</Button>
        </ServerActionForm>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الرمز</th>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">السياسة</th>
              <th className="px-4 py-3 text-right">الوقت</th>
              <th className="px-4 py-3 text-right">نشط</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                <td className="px-4 py-3">{s.name_ar}</td>
                <td className="px-4 py-3">{policyMap.get(s.policy_id) ?? "—"}</td>
                <td className="px-4 py-3">
                  {String(s.start_time).slice(0, 5)} → {String(s.end_time).slice(0, 5)}
                  {s.crosses_midnight ? " *" : ""}
                </td>
                <td className="px-4 py-3">{s.is_active ? "نعم" : "لا"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PageContainer>
  );
}
