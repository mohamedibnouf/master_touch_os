import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertLeaveTypeAction } from "@/server/use-cases/leave";

export default async function HrLeaveTypesPage() {
  authorize(await getAuthContext(), "leave.manage");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const types = await new LeaveRepository(supabase).listLeaveTypes(ctx.organization.id);

  return (
    <div>
      <PageHeader title="أنواع الإجازة" description="إدارة سياسات وأنواع الإجازات للمؤسسة" />

      <Card className="mb-6" data-testid="leave-type-form">
        <h2 className="mb-4 font-semibold text-navy">إضافة / تحديث نوع</h2>
        <ServerActionForm action={upsertLeaveTypeAction} className="grid gap-3 md:grid-cols-2">
          <Field label="الرمز">
            <Input name="code" required placeholder="ANNUAL" />
          </Field>
          <Field label="الاستحقاق السنوي (أيام)">
            <Input name="annual_entitlement_days" type="number" step="0.5" defaultValue={0} />
          </Field>
          <Field label="الاسم بالعربية">
            <Input name="name_ar" required />
          </Field>
          <Field label="Name (EN)">
            <Input name="name_en" required />
          </Field>
          <Field label="إشعار أدنى (أيام)">
            <Input name="minimum_notice_days" type="number" defaultValue={0} />
          </Field>
          <Field label="أقصى أيام متتالية">
            <Input name="maximum_consecutive_days" type="number" />
          </Field>
          <Field label="مدفوعة؟">
            <Select name="is_paid" defaultValue="true">
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="تتطلب مرفقاً؟">
            <Select name="requires_attachment" defaultValue="false">
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </Select>
          </Field>
          <Field label="ترحيل رصيد؟">
            <Select name="allow_carry_forward" defaultValue="false">
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </Select>
          </Field>
          <Field label="سماح برصيد سالب؟">
            <Select name="allow_negative_balance" defaultValue="false">
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit">حفظ النوع</Button>
          </div>
        </ServerActionForm>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الرمز</th>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">الاستحقاق</th>
              <th className="px-4 py-3 text-right">مدفوعة</th>
              <th className="px-4 py-3 text-right">نشط</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="px-4 py-3 font-mono text-xs">{t.code}</td>
                <td className="px-4 py-3">{t.name_ar}</td>
                <td className="px-4 py-3">{t.annual_entitlement_days}</td>
                <td className="px-4 py-3">{t.is_paid ? "نعم" : "لا"}</td>
                <td className="px-4 py-3">{t.is_active ? "نعم" : "لا"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
