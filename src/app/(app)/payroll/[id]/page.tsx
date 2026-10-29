import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Field, Input, PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { isUuid } from "@/lib/utils";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  approvePayrollPeriodAction,
  calculatePayrollPeriodAction,
  cancelPayrollPeriodAction,
  lockPayrollPeriodAction,
  markPayrollReviewedAction,
  submitPayrollForReviewAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";
import { formatPeriodLabel, formatSar } from "@/lib/payroll/format";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function statusTone(status: string): "neutral" | "success" | "danger" | "warning" | "navy" {
  if (status === "paid" || status === "locked" || status === "approved") return "success";
  if (status === "cancelled") return "danger";
  if (status === "under_review" || status === "calculated") return "warning";
  return "navy";
}

export default async function PayrollPeriodDetailPage({
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
    hasPermission(ctx, "payroll.record_payment") ||
    hasPermission(ctx, "payroll.lock");
  if (!canView) redirect("/my/payslips");

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const [period, { t, locale }] = await Promise.all([repo.getPeriod(ctx.organization.id, id), getI18n()]);
  if (!period) notFound();
  const tp = t.payroll.period;
  const tc = t.payroll.common;

  const status = period.status;
  const canCalculate =
    hasPermission(ctx, "payroll.calculate") && (status === "draft" || status === "calculated");
  const canSubmit = hasPermission(ctx, "payroll.prepare") && status === "calculated";
  const canReview = hasPermission(ctx, "payroll.review") && status === "under_review";
  const canApprove = hasPermission(ctx, "payroll.approve") && status === "under_review";
  const canLock = hasPermission(ctx, "payroll.lock") && status === "approved";
  const canCancel =
    hasPermission(ctx, "payroll.prepare") && (status === "draft" || status === "calculated");
  const hasAction = canCalculate || canSubmit || canReview || canApprove || canLock;

  return (
    <PageContainer data-testid="payroll-period-detail" className="space-y-5">
      <PageHeader
        title={format(tp.title, { period: formatPeriodLabel(period.year, period.month) })}
        description={format(tc.periodRange, { start: period.period_start, end: period.period_end })}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}/employees`}>
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-employees-link">
                {tc.employees}
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/review`}>
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-review-link">
                {tc.review}
              </Button>
            </Link>
            <Link href="/payroll">
              <Button variant="secondary" className="w-full sm:w-auto">
                {tc.back}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={tc.status}
          value={
            <Badge tone={statusTone(status)} data-testid="payroll-period-status">
              {payrollPeriodStatusLabel(status, locale)}
            </Badge>
          }
        />
        <StatCard label={tp.employeeCount} value={period.employee_count} />
        <StatCard label={tp.totalGross} value={<span className="text-xl">{formatSar(period.total_gross, locale)}</span>} />
        <StatCard
          label={tp.totalNet}
          tone="info"
          value={
            <span className="text-xl" data-testid="payroll-period-net">
              {formatSar(period.total_net, locale)}
            </span>
          }
        />
      </div>

      <Section title={tp.actionsTitle}>
        <div className="flex flex-wrap gap-2">
          {canCalculate ? (
            <ServerActionForm action={calculatePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-calculate-btn">
                {tp.calculate}
              </Button>
            </ServerActionForm>
          ) : null}
          {canSubmit ? (
            <ServerActionForm action={submitPayrollForReviewAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-submit-btn">
                {tp.submitForReview}
              </Button>
            </ServerActionForm>
          ) : null}
          {canReview ? (
            <ServerActionForm action={markPayrollReviewedAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" variant="secondary" data-testid="payroll-review-btn">
                {tp.confirmReview}
              </Button>
            </ServerActionForm>
          ) : null}
          {canApprove ? (
            <ServerActionForm action={approvePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-approve-btn">
                {tp.approve}
              </Button>
            </ServerActionForm>
          ) : null}
          {canLock ? (
            <ServerActionForm action={lockPayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-lock-btn">
                {tp.lock}
              </Button>
            </ServerActionForm>
          ) : null}
          {!hasAction && !canCancel ? <p className="text-sm text-muted">{tp.noActions}</p> : null}
        </div>

        {canCancel ? (
          <ServerActionForm action={cancelPayrollPeriodAction} className="mt-4 border-t border-line pt-4" testId="payroll-cancel-form">
            <div className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="periodId" value={period.id} />
              <div className="sm:col-span-2">
                <Field label={tp.cancelReason}>
                  <Input name="reason" required minLength={3} placeholder={tp.cancelReason} />
                </Field>
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" className="w-full sm:w-auto" data-testid="payroll-cancel-btn">
                  {tp.cancelPeriod}
                </Button>
              </div>
            </div>
          </ServerActionForm>
        ) : null}
      </Section>

      <Section title={tp.summaryTitle}>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-surface-muted p-3">
            <dt className="text-xs text-muted">{tp.earnings}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{formatSar(period.total_gross, locale)}</dd>
          </div>
          <div className="rounded-lg bg-surface-muted p-3">
            <dt className="text-xs text-muted">{tp.deductions}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-danger">{formatSar(period.total_deductions, locale)}</dd>
          </div>
          <div className="rounded-lg bg-primary-soft p-3">
            <dt className="text-xs text-primary">{tp.net}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-primary">{formatSar(period.total_net, locale)}</dd>
          </div>
        </dl>
      </Section>
    </PageContainer>
  );
}
