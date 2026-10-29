import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  addPayrollManualDeductionAction,
  addPayrollManualEarningAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { formatPeriodLabel, formatSar } from "@/lib/payroll/format";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { PayrollEntry } from "@/types/models";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";

function paymentTone(status: string): "neutral" | "success" | "warning" {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  return "neutral";
}

function ManualLineForm({
  kind,
  entries: rows,
  te,
}: {
  kind: "earning" | "deduction";
  entries: PayrollEntry[];
  te: Dictionary["payroll"]["employees"];
}) {
  const isEarning = kind === "earning";
  return (
    <Card data-testid={isEarning ? "payroll-manual-earning-form" : "payroll-manual-deduction-form"}>
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {isEarning ? te.manualEarningTitle : te.manualDeductionTitle}
      </h2>
      <ServerActionForm action={isEarning ? addPayrollManualEarningAction : addPayrollManualDeductionAction}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={te.entry}>
              <Select name="entryId" required defaultValue="">
                <option value="" disabled>
                  {te.chooseEmployee}
                </option>
                {rows.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_name ?? e.employee_number ?? e.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={te.code}>
            <Input name="code" required placeholder={isEarning ? "BONUS" : "ADVANCE"} dir="ltr" />
          </Field>
          <Field label={te.amount}>
            <Input name="amount" type="number" step="0.01" min="0.01" required />
          </Field>
          <Field label={te.descriptionAr}>
            <Input name="descriptionAr" required dir="rtl" />
          </Field>
          <Field label={te.descriptionEn}>
            <Input name="descriptionEn" required dir="ltr" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={te.reason}>
              <Input name="reason" required minLength={3} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant={isEarning ? "primary" : "secondary"}>
              {isEarning ? te.addEarning : te.addDeduction}
            </Button>
          </div>
        </div>
      </ServerActionForm>
    </Card>
  );
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
  const [period, { t, locale }] = await Promise.all([repo.getPeriod(ctx.organization.id, id), getI18n()]);
  if (!period) notFound();
  const te = t.payroll.employees;
  const tc = t.payroll.common;

  const entries = await repo.listEntries(period.id);
  const canAdjust =
    hasPermission(ctx, "payroll.adjust") &&
    (period.status === "draft" || period.status === "calculated" || period.status === "under_review");

  const paymentLabel = (status: string) =>
    status in tc.paymentStatus ? tc.paymentStatus[status as keyof typeof tc.paymentStatus] : status;

  return (
    <PageContainer data-testid="payroll-employees" className="space-y-5">
      <PageHeader
        title={format(te.title, { period: formatPeriodLabel(period.year, period.month) })}
        description={payrollPeriodStatusLabel(period.status, locale)}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                {tc.periodDetails}
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/review`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                {tc.review}
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{te.entriesTitle}</div>
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState title={te.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{te.colNumber}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{te.colEmployee}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{te.colGross}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{te.colDeductions}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{te.colNet}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{te.colPayment}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{te.colPayslip}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-line" data-testid="payroll-entry-row">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{e.employee_number ?? "—"}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{e.employee_name ?? e.employee_id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{formatSar(e.gross_pay, locale)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums text-danger">
                      {formatSar(e.total_deductions, locale)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold tabular-nums text-ink">
                      {formatSar(e.net_pay, locale)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={paymentTone(e.payment_status)}>{paymentLabel(e.payment_status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/payroll/payslips/${e.id}`} className="font-medium text-primary hover:underline">
                        {te.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {canAdjust && entries.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ManualLineForm kind="earning" entries={entries} te={te} />
          <ManualLineForm kind="deduction" entries={entries} te={te} />
        </div>
      ) : null}
    </PageContainer>
  );
}
