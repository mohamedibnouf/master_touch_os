import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { updatePayrollSettingsAction } from "@/server/use-cases/payroll";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function PayrollSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "payroll.manage_settings")) redirect("/payroll");

  const supabase = await createServerSupabaseClient();
  const settings = await new PayrollRepository(supabase).getSettings(ctx.organization.id);

  return (
    <PageContainer data-testid="payroll-settings" className="space-y-5">
      <PageHeader
        title="إعدادات الرواتب"
        description="قواعد الاحتساب والصرف الافتراضية"
        actions={
          <Link href="/payroll">
            <Button variant="secondary">العودة للرواتب</Button>
          </Link>
        }
      />

      <Card data-testid="payroll-settings-form">
        <ServerActionForm action={updatePayrollSettingsAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="العملة">
            <Input name="currency" defaultValue={settings?.currency ?? "SAR"} required />
          </Field>
          <Field label="أيام الاستحقاق القياسية">
            <Input
              name="standardPayableDays"
              type="number"
              step="0.01"
              min="1"
              defaultValue={settings?.standard_payable_days ?? 30}
              required
            />
          </Field>
          <Field label="خصم الإجازة غير المدفوعة">
            <Select name="deductUnpaidLeave" defaultValue={settings?.deduct_unpaid_leave !== false ? "true" : "false"}>
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="خصم الغياب">
            <Select name="deductAbsence" defaultValue={settings?.deduct_absence ? "true" : "false"}>
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="خصم دقائق التأخير">
            <Select name="deductLateMinutes" defaultValue={settings?.deduct_late_minutes ? "true" : "false"}>
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </Select>
          </Field>
          <Field label="دقة التقريب">
            <Input
              name="roundingPrecision"
              type="number"
              min={0}
              max={6}
              defaultValue={settings?.rounding_precision ?? 2}
              required
            />
          </Field>
          <Field label="طريقة الصرف الافتراضية">
            <Select name="defaultPaymentMethod" defaultValue={settings?.default_payment_method ?? "bank_transfer"}>
              <option value="bank_transfer">تحويل بنكي</option>
              <option value="cash">نقداً</option>
              <option value="cheque">شيك</option>
              <option value="other">أخرى</option>
            </Select>
          </Field>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" data-testid="payroll-settings-save">
              حفظ الإعدادات
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
