import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { createPayrollPeriodAction } from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";
import { formatPeriodLabel, formatSar, monthName } from "@/lib/payroll/format";
import { getI18n } from "@/lib/i18n/server";

function statusTone(status: string): "neutral" | "success" | "danger" | "warning" | "navy" {
  if (status === "paid" || status === "locked" || status === "approved") return "success";
  if (status === "cancelled") return "danger";
  if (status === "under_review" || status === "calculated") return "warning";
  return "navy";
}

export default async function PayrollDashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canViewAll = hasPermission(ctx, "payroll.view_all");
  const canPrepare = hasPermission(ctx, "payroll.prepare");
  const canSettings = hasPermission(ctx, "payroll.manage_settings");
  const canSelf = hasPermission(ctx, "payroll.view_self");
  const canOps =
    canViewAll ||
    canPrepare ||
    hasPermission(ctx, "payroll.calculate") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.adjust") ||
    hasPermission(ctx, "payroll.record_payment") ||
    canSettings;

  if (!canOps && !canSelf) redirect("/");
  if (!canOps && canSelf) redirect("/my/payslips");

  const { t, locale } = await getI18n();
  const td = t.payroll.dashboard;

  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const periods = await repo.listPeriods(ctx.organization.id);
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  return (
    <PageContainer data-testid="payroll-dashboard" className="space-y-5">
      <PageHeader
        title={td.title}
        description={td.description}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canSelf ? (
              <Link href="/my/payslips">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-my-payslips-link">
                  {td.myPayslips}
                </Button>
              </Link>
            ) : null}
            {canSettings ? (
              <Link href="/payroll/settings">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-settings-link">
                  {td.settings}
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {canPrepare ? (
        <Card data-testid="payroll-create-form">
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.createTitle}</h2>
          <ServerActionForm action={createPayrollPeriodAction}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={td.year}>
                <Input type="number" name="year" defaultValue={defaultYear} min={2000} max={2100} required />
              </Field>
              <Field label={td.month}>
                <Select name="month" defaultValue={String(defaultMonth)} required>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, "0")} · {monthName(m, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="w-full sm:w-auto" data-testid="payroll-create-submit">
                  {td.create}
                </Button>
              </div>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{td.periodsTitle}</div>
        {periods.length === 0 ? (
          <div className="p-4">
            <EmptyState title={td.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{td.colPeriod}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{td.colStatus}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{td.colEmployees}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{td.colGross}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{td.colNet}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-t border-line" data-testid="payroll-period-row">
                    <td className="px-4 py-2.5">
                      <Link href={`/payroll/${p.id}`} className="font-medium tabular-nums text-primary hover:underline">
                        {formatPeriodLabel(p.year, p.month)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(p.status)}>{payrollPeriodStatusLabel(p.status, locale)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{p.employee_count}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{formatSar(p.total_gross, locale)}</td>
                    <td className="px-4 py-2.5 text-end font-medium tabular-nums text-ink">
                      {formatSar(p.total_net, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </PageContainer>
  );
}
