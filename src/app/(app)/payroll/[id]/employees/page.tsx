import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  addPayrollManualDeductionAction,
  addPayrollManualEarningAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

export default async function PayrollEmployeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canView =
    hasPermission(ctx, "payroll.view_all") ||
    hasPermission(ctx, "payroll.prepare") ||
    hasPermission(ctx, "payroll.calculate") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.adjust") ||
    hasPermission(ctx, "payroll.record_payment");
  if (!canView) redirect("/payroll");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const period = await repo.getPeriod(ctx.organization.id, id);
  if (!period) notFound();

  const entries = await repo.listEntries(period.id);
  const canAdjust =
    hasPermission(ctx, "payroll.adjust") &&
    (period.status === "draft" || period.status === "calculated" || period.status === "under_review");

  return (
    <div data-testid="payroll-employees">
      <PageHeader
        title={`موظفو المسير ${period.year}/${String(period.month).padStart(2, "0")}`}
        description={payrollPeriodStatusLabel(period.status)}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                تفاصيل الفترة
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/review`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                المراجعة
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="mb-6 overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">قيود الرواتب</div>
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد قيود. شغّل الاحتساب أولاً." />
          </div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الرقم</th>
                <th className="px-4 py-3 text-right">الموظف</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
                <th className="px-4 py-3 text-right">الخصم</th>
                <th className="px-4 py-3 text-right">الصافي</th>
                <th className="px-4 py-3 text-right">الصرف</th>
                <th className="px-4 py-3 text-right">قسيمة</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-line" data-testid="payroll-entry-row">
                  <td className="px-4 py-3 font-mono text-xs">{e.employee_number ?? "—"}</td>
                  <td className="px-4 py-3">{e.employee_name ?? e.employee_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatSar(e.gross_pay)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatSar(e.total_deductions)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatSar(e.net_pay)}</td>
                  <td className="px-4 py-3">
                    <Badge>{e.payment_status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/payroll/payslips/${e.id}`} className="text-navy underline">
                      عرض
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canAdjust && entries.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="payroll-manual-earning-form">
            <h2 className="mb-3 font-semibold text-navy">استحقاق يدوي</h2>
            <form action={addPayrollManualEarningAction} className="grid gap-3">
              <Field label="القيد">
                <Select name="entryId" required defaultValue="">
                  <option value="" disabled>
                    اختر موظفاً
                  </option>
                  {entries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_name ?? e.employee_number ?? e.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الرمز">
                <Input name="code" required placeholder="BONUS" />
              </Field>
              <Field label="الوصف بالعربية">
                <Input name="descriptionAr" required />
              </Field>
              <Field label="Description (EN)">
                <Input name="descriptionEn" required />
              </Field>
              <Field label="المبلغ">
                <Input name="amount" type="number" step="0.01" min="0.01" required />
              </Field>
              <Field label="السبب">
                <Input name="reason" required minLength={3} />
              </Field>
              <Button type="submit">إضافة استحقاق</Button>
            </form>
          </Card>

          <Card data-testid="payroll-manual-deduction-form">
            <h2 className="mb-3 font-semibold text-navy">خصم يدوي</h2>
            <form action={addPayrollManualDeductionAction} className="grid gap-3">
              <Field label="القيد">
                <Select name="entryId" required defaultValue="">
                  <option value="" disabled>
                    اختر موظفاً
                  </option>
                  {entries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_name ?? e.employee_number ?? e.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="الرمز">
                <Input name="code" required placeholder="ADVANCE" />
              </Field>
              <Field label="الوصف بالعربية">
                <Input name="descriptionAr" required />
              </Field>
              <Field label="Description (EN)">
                <Input name="descriptionEn" required />
              </Field>
              <Field label="المبلغ">
                <Input name="amount" type="number" step="0.01" min="0.01" required />
              </Field>
              <Field label="السبب">
                <Input name="reason" required minLength={3} />
              </Field>
              <Button type="submit">إضافة خصم</Button>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
