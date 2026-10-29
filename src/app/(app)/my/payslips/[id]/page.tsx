import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { formatPeriodLabel } from "@/lib/payroll/format";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { PayslipDocument } from "../../../payroll/_components/payslip-document";

export default async function MyPayslipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "payroll.view_self") && !hasPermission(ctx, "payroll.view_all")) {
    redirect("/");
  }
  if (!ctx.employee) redirect("/my/payslips");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const [entry, { t, locale }] = await Promise.all([repo.getEntry(id), getI18n()]);
  if (!entry || entry.organization_id !== ctx.organization.id) notFound();
  if (entry.employee_id !== ctx.employee.id) redirect("/my/payslips");
  const tm = t.payroll.my;

  const period = await repo.getPeriod(ctx.organization.id, entry.payroll_period_id);
  const [earnings, deductions] = await Promise.all([
    repo.listEarnings(entry.id),
    repo.listDeductions(entry.id),
  ]);

  return (
    <PageContainer data-testid="my-payslip-detail" className="space-y-5">
      <PageHeader
        title={tm.detailTitle}
        description={
          period
            ? format(t.payroll.payslip.periodLabel, { period: formatPeriodLabel(period.year, period.month) })
            : tm.detailFallback
        }
        actions={
          <Link href="/my/payslips" className="print:hidden">
            <Button variant="secondary">{t.payroll.common.back}</Button>
          </Link>
        }
      />

      <PayslipDocument
        entry={entry}
        period={period}
        earnings={earnings}
        deductions={deductions}
        t={t.payroll}
        locale={locale}
        netTestId="my-payslip-net"
      />
    </PageContainer>
  );
}
