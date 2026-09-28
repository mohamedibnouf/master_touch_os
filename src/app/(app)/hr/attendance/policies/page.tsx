import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertAttendancePolicyAction } from "@/server/use-cases/attendance";

export default async function HrAttendancePoliciesPage() {
  authorize(await getAuthContext(), "attendance.manage_policies");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const policies = await new AttendanceRepository(supabase).listPolicies(ctx.organization.id);

  return (
    <PageContainer data-testid="attendance-policies" className="space-y-5">
      <PageHeader title="سياسات الحضور" description="إدارة سياسات التأخير والحد الأدنى للعمل" />

      <Card className="mb-6" data-testid="attendance-policy-form">
        <h2 className="mb-4 font-semibold text-navy">إضافة / تحديث سياسة</h2>
        <ServerActionForm action={upsertAttendancePolicyAction} className="grid gap-3">
          <Field label="الرمز">
            <Input name="code" required placeholder="DEFAULT" />
          </Field>
          <Field label="الاسم بالعربية">
            <Input name="name_ar" required />
          </Field>
          <Field label="Name (EN)">
            <Input name="name_en" required />
          </Field>
          <Field label="سماح التأخير (دقائق)">
            <Input name="late_grace_minutes" type="number" defaultValue={15} />
          </Field>
          <Field label="سماح الانصراف المبكر (دقائق)">
            <Input name="early_leave_grace_minutes" type="number" defaultValue={15} />
          </Field>
          <Field label="حد أدنى للعمل (دقائق)">
            <Input name="minimum_work_minutes" type="number" defaultValue={240} />
          </Field>
          <Field label="تأخير التسوية (ساعات)">
            <Input name="reconciliation_delay_hours" type="number" defaultValue={8} />
          </Field>
          <Field label="سماح تسجيل الدخول اليدوي؟">
            <Select name="allow_manual_check_in" defaultValue="true">
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="سماح تسجيل الانصراف اليدوي؟">
            <Select name="allow_manual_check_out" defaultValue="true">
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="نشط؟">
            <Select name="is_active" defaultValue="true">
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Button type="submit">حفظ السياسة</Button>
        </ServerActionForm>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الرمز</th>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">سماح التأخير</th>
              <th className="px-4 py-3 text-right">حد أدنى</th>
              <th className="px-4 py-3 text-right">نشط</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-4 py-3">{p.name_ar}</td>
                <td className="px-4 py-3">{p.late_grace_minutes}</td>
                <td className="px-4 py-3">{p.minimum_work_minutes}</td>
                <td className="px-4 py-3">{p.is_active ? "نعم" : "لا"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PageContainer>
  );
}
