import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { recordPayrollPaymentAction } from "@/server/use-cases/payroll";
import { ServerActionForm } from "@/components/forms/server-action-form";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

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
  const entry = await repo.getEntry(id);
  if (!entry || entry.organization_id !== ctx.organization.id) notFound();

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
    <div data-testid="payroll-payslip">
      <PageHeader
        title={`قسيمة ${entry.employee_name ?? entry.employee_number ?? ""}`}
        description={
          period
            ? `مسير ${period.year}/${String(period.month).padStart(2, "0")}`
            : "قسيمة راتب"
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {period ? (
              <Link href={`/payroll/${period.id}/employees`}>
                <Button variant="secondary" className="w-full sm:w-auto">
                  قائمة الموظفين
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">الإجمالي</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums">{formatSar(entry.gross_pay)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الخصومات</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums">{formatSar(entry.total_deductions)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الصافي</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums" data-testid="payroll-payslip-net">
            {formatSar(entry.net_pay)}
          </p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy">الاستحقاقات</h2>
          {earnings.length === 0 ? (
            <EmptyState title="لا توجد بنود استحقاق." />
          ) : (
            <ul className="space-y-2 text-sm">
              {earnings.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2"
                  data-testid="payroll-earning-row"
                >
                  <span>
                    {row.description_ar}
                    {row.is_manual ? <Badge className="ms-2">يدوي</Badge> : null}
                  </span>
                  <span className="tabular-nums">{formatSar(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold text-navy">الخصومات</h2>
          {deductions.length === 0 ? (
            <EmptyState title="لا توجد بنود خصم." />
          ) : (
            <ul className="space-y-2 text-sm">
              {deductions.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2"
                  data-testid="payroll-deduction-row"
                >
                  <span>
                    {row.description_ar}
                    {row.is_manual ? <Badge className="ms-2">يدوي</Badge> : null}
                  </span>
                  <span className="tabular-nums">{formatSar(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {canPay ? (
        <Card data-testid="payroll-payment-form">
          <h2 className="mb-3 font-semibold text-navy">تسجيل صرف</h2>
          <ServerActionForm action={recordPayrollPaymentAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="entryId" value={entry.id} />
            <Field label="تاريخ الصرف">
              <Input type="date" name="paymentDate" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="الطريقة">
              <Select name="paymentMethod" defaultValue="bank_transfer">
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cash">نقداً</option>
                <option value="cheque">شيك</option>
                <option value="other">أخرى</option>
              </Select>
            </Field>
            <Field label="المرجع">
              <Input name="paymentReference" />
            </Field>
            <Field label="المبلغ">
              <Input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={Number(entry.net_pay).toFixed(2)}
                required
              />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" data-testid="payroll-record-payment">
                تسجيل الصرف
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}
    </div>
  );
}
