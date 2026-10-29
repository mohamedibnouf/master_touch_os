import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  approvePayrollPeriodAction,
  lockPayrollPeriodAction,
  markPayrollReviewedAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { formatPeriodLabel, formatSar } from "@/lib/payroll/format";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function PayrollReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canView =
    hasPermission(ctx, "payroll.view_all") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.lock") ||
    hasPermission(ctx, "payroll.prepare");
  if (!canView) redirect("/payroll");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const [period, { t, locale }] = await Promise.all([repo.getPeriod(ctx.organization.id, id), getI18n()]);
  if (!period) notFound();
  const tr = t.payroll.review;
  const tc = t.payroll.common;

  const entries = await repo.listEntries(period.id);
  const status = period.status;
  const canReview = hasPermission(ctx, "payroll.review") && status === "under_review";
  const canApprove = hasPermission(ctx, "payroll.approve") && status === "under_review";
  const canLock = hasPermission(ctx, "payroll.lock") && status === "approved";
  const topEntries = [...entries].sort((a, b) => b.net_pay - a.net_pay).slice(0, 10);

  return (
    <PageContainer data-testid="payroll-review" className="space-y-5">
      <PageHeader
        title={format(tr.title, { period: formatPeriodLabel(period.year, period.month) })}
        description={tr.description}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                {tc.periodDetails}
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/employees`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                {tc.employees}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={tc.status}
          value={<Badge data-testid="payroll-review-status">{payrollPeriodStatusLabel(status, locale)}</Badge>}
        />
        <StatCard label={tr.entryCount} value={entries.length} />
        <StatCard
          label={tr.deductions}
          tone="danger"
          value={<span className="text-xl">{formatSar(period.total_deductions, locale)}</span>}
        />
        <StatCard label={tr.net} tone="info" value={<span className="text-xl">{formatSar(period.total_net, locale)}</span>} />
      </div>

      <Section title={tr.actionsTitle}>
        <div className="flex flex-wrap gap-2">
          {canReview ? (
            <ServerActionForm action={markPayrollReviewedAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-review-action">
                {tr.confirmReview}
              </Button>
            </ServerActionForm>
          ) : null}
          {canApprove ? (
            <ServerActionForm action={approvePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-approve-action">
                {tr.approve}
              </Button>
            </ServerActionForm>
          ) : null}
          {canLock ? (
            <ServerActionForm action={lockPayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-lock-action">
                {tr.lock}
              </Button>
            </ServerActionForm>
          ) : null}
          {!canReview && !canApprove && !canLock ? <p className="text-sm text-muted">{tr.noActions}</p> : null}
        </div>
      </Section>

      <Section title={tr.topNetTitle}>
        {topEntries.length === 0 ? (
          <p className="text-sm text-muted">{tr.empty}</p>
        ) : (
          <ol className="divide-y divide-line text-sm">
            {topEntries.map((e, i) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                data-testid="payroll-review-entry"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted">{i + 1}</span>
                  <span className="truncate text-ink">{e.employee_name ?? e.employee_number ?? e.id.slice(0, 8)}</span>
                </span>
                <span className="font-semibold tabular-nums text-ink">{formatSar(e.net_pay, locale)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </PageContainer>
  );
}
