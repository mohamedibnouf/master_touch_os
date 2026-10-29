import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { recordPayrollPaymentAction } from "@/server/use-cases/payroll";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { formatPeriodLabel } from "@/lib/payroll/format";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { PayslipDocument } from "../../_components/payslip-document";

export default async function PayrollPayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canView =
    hasPermission(ctx, "payroll.view_all") ||
    hasPermission(ctx, "payroll.prepare") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.record_payment") ||
    hasPermission(ctx, "payroll.adjust");
  if (!canView) redirect("/my/payslips");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const [entry, { t, locale }] = await Promise.all([repo.getEntry(id), getI18n()]);
  if (!entry || entry.organization_id !== ctx.organization.id) notFound();
  const tp = t.payroll.payslip;
  const tc = t.payroll.common;

  const period = await repo.getPeriod(ctx.organization.id, entry.payroll_period_id);
  const [earnings, deductions] = await Promise.all([
    repo.listEarnings(entry.id),
    repo.listDeductions(entry.id),
  ]);

  const canPay =
    hasPermission(ctx, "payroll.record_payment") &&
    period != null &&
    (period.status === "locked" || period.status === "approved" || period.status === "paid") &&
    entry.payment_status !== "paid";

  return (
    <PageContainer data-testid="payroll-payslip" className="space-y-5">
      <PageHeader
        title={format(tp.title, { name: entry.employee_name ?? entry.employee_number ?? "" })}
        description={
          period ? format(tp.periodLabel, { period: formatPeriodLabel(period.year, period.month) }) : tp.documentTitle
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row print:hidden">
            {period ? (
              <Link href={`/payroll/${period.id}/employees`}>
                <Button variant="secondary" className="w-full sm:w-auto">
                  {tp.employeeList}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <PayslipDocument
        entry={entry}
        period={period}
        earnings={earnings}
        deductions={deductions}
        t={t.payroll}
        locale={locale}
        netTestId="payroll-payslip-net"
        earningRowTestId="payroll-earning-row"
        deductionRowTestId="payroll-deduction-row"
        showManual
      />

      {canPay ? (
        <Card data-testid="payroll-payment-form" className="print:hidden">
          <h2 className="mb-3 text-sm font-semibold text-ink">{tp.paymentTitle}</h2>
          <ServerActionForm action={recordPayrollPaymentAction}>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="entryId" value={entry.id} />
              <Field label={tp.paymentDate}>
                <Input type="date" name="paymentDate" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
              <Field label={tp.paymentMethod}>
                <Select name="paymentMethod" defaultValue="bank_transfer">
                  <option value="bank_transfer">{tc.paymentMethods.bank_transfer}</option>
                  <option value="cash">{tc.paymentMethods.cash}</option>
                  <option value="cheque">{tc.paymentMethods.cheque}</option>
                  <option value="other">{tc.paymentMethods.other}</option>
                </Select>
              </Field>
              <Field label={tp.paymentReference}>
                <Input name="paymentReference" dir="ltr" />
              </Field>
              <Field label={tp.amount}>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={Number(entry.net_pay).toFixed(2)}
                  required
                />
              </Field>
              <Field label={tp.notes}>
                <Input name="notes" />
              </Field>
              <div className="flex items-end">
                <Button type="submit" data-testid="payroll-record-payment">
                  {tp.recordPayment}
                </Button>
              </div>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}
    </PageContainer>
  );
}
