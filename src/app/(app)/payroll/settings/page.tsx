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
import { getI18n } from "@/lib/i18n/server";

export default async function PayrollSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "payroll.manage_settings")) redirect("/payroll");

  const { t } = await getI18n();
  const ts = t.payroll.settings;
  const tc = t.payroll.common;

  const supabase = await createServerSupabaseClient();
  const settings = await new PayrollRepository(supabase).getSettings(ctx.organization.id);

  return (
    <PageContainer data-testid="payroll-settings" className="space-y-5">
      <PageHeader
        title={ts.title}
        description={ts.description}
        actions={
          <Link href="/payroll">
            <Button variant="secondary">{ts.back}</Button>
          </Link>
        }
      />

      <Card data-testid="payroll-settings-form">
        <ServerActionForm action={updatePayrollSettingsAction}>
          <div className="space-y-6">
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink">{ts.calculationTitle}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={ts.currency}>
                  <Input name="currency" defaultValue={settings?.currency ?? "SAR"} required dir="ltr" />
                </Field>
                <Field label={ts.standardPayableDays}>
                  <Input
                    name="standardPayableDays"
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue={settings?.standard_payable_days ?? 30}
                    required
                  />
                </Field>
                <Field label={ts.deductUnpaidLeave}>
                  <Select
                    name="deductUnpaidLeave"
                    defaultValue={settings?.deduct_unpaid_leave !== false ? "true" : "false"}
                  >
                    <option value="true">{tc.yes}</option>
                    <option value="false">{tc.no}</option>
                  </Select>
                </Field>
                <Field label={ts.deductAbsence}>
                  <Select name="deductAbsence" defaultValue={settings?.deduct_absence ? "true" : "false"}>
                    <option value="true">{tc.yes}</option>
                    <option value="false">{tc.no}</option>
                  </Select>
                </Field>
                <Field label={ts.deductLateMinutes}>
                  <Select name="deductLateMinutes" defaultValue={settings?.deduct_late_minutes ? "true" : "false"}>
                    <option value="true">{tc.yes}</option>
                    <option value="false">{tc.no}</option>
                  </Select>
                </Field>
                <Field label={ts.roundingPrecision}>
                  <Input
                    name="roundingPrecision"
                    type="number"
                    min={0}
                    max={6}
                    defaultValue={settings?.rounding_precision ?? 2}
                    required
                  />
                </Field>
              </div>
            </section>

            <section className="border-t border-line pt-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">{ts.paymentTitle}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={ts.defaultPaymentMethod}>
                  <Select name="defaultPaymentMethod" defaultValue={settings?.default_payment_method ?? "bank_transfer"}>
                    <option value="bank_transfer">{tc.paymentMethods.bank_transfer}</option>
                    <option value="cash">{tc.paymentMethods.cash}</option>
                    <option value="cheque">{tc.paymentMethods.cheque}</option>
                    <option value="other">{tc.paymentMethods.other}</option>
                  </Select>
                </Field>
              </div>
            </section>

            <div>
              <Button type="submit" data-testid="payroll-settings-save">
                {ts.save}
              </Button>
            </div>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
