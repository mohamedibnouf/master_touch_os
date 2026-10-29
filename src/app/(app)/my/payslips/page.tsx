import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { formatPeriodLabel, formatSar } from "@/lib/payroll/format";
import { getI18n } from "@/lib/i18n/server";

function paymentTone(status: string): "neutral" | "success" | "warning" {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  return "neutral";
}

export default async function MyPayslipsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "payroll.view_self") && !hasPermission(ctx, "payroll.view_all")) {
    redirect("/");
  }

  const { t, locale } = await getI18n();
  const tm = t.payroll.my;
  const tc = t.payroll.common;

  if (!ctx.employee) {
    return (
      <PageContainer data-testid="my-payslips" className="space-y-5">
        <PageHeader title={tm.noEmployeeTitle} description={tm.noEmployeeDescription} />
        <EmptyState title={tm.noEmployeeHint} />
      </PageContainer>
    );
  }

  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const entries = await repo.listMyEntries(ctx.employee.id);

  const periodIds = [...new Set(entries.map((e) => e.payroll_period_id))];
  const periods = new Map<string, { year: number; month: number }>();
  await Promise.all(
    periodIds.map(async (pid) => {
      const p = await repo.getPeriod(ctx.organization.id, pid);
      if (p) periods.set(pid, { year: p.year, month: p.month });
    }),
  );

  const canOps = hasPermission(ctx, "payroll.view_all") || hasPermission(ctx, "payroll.prepare");
  const paymentLabel = (status: string) =>
    status in tc.paymentStatus ? tc.paymentStatus[status as keyof typeof tc.paymentStatus] : status;

  return (
    <PageContainer data-testid="my-payslips" className="space-y-5">
      <PageHeader
        title={tm.title}
        description={tm.description}
        actions={
          canOps ? (
            <Link href="/payroll">
              <Button variant="secondary">{tm.manage}</Button>
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tm.historyTitle}</div>
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tm.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tm.colPeriod}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{tm.colGross}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{tm.colNet}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tm.colPayment}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const p = periods.get(e.payroll_period_id);
                  const label = p ? formatPeriodLabel(p.year, p.month) : "—";
                  return (
                    <tr key={e.id} className="border-t border-line" data-testid="my-payslip-row">
                      <td className="px-4 py-2.5">
                        <Link href={`/my/payslips/${e.id}`} className="font-medium tabular-nums text-primary hover:underline">
                          {label}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-end tabular-nums">{formatSar(e.gross_pay, locale)}</td>
                      <td className="px-4 py-2.5 text-end font-semibold tabular-nums text-ink">
                        {formatSar(e.net_pay, locale)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={paymentTone(e.payment_status)}>{paymentLabel(e.payment_status)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </PageContainer>
  );
}
