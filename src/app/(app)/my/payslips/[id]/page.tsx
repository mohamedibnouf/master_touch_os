import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

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
  const entry = await repo.getEntry(id);
  if (!entry || entry.organization_id !== ctx.organization.id) notFound();
  if (entry.employee_id !== ctx.employee.id) redirect("/my/payslips");

  const period = await repo.getPeriod(ctx.organization.id, entry.payroll_period_id);
  const [earnings, deductions] = await Promise.all([
    repo.listEarnings(entry.id),
    repo.listDeductions(entry.id),
  ]);

  return (
    <PageContainer data-testid="my-payslip-detail" className="space-y-5">
      <PageHeader
        title="قسيمة راتبي"
        description={
          period
            ? `مسير ${period.year}/${String(period.month).padStart(2, "0")}`
            : "تفاصيل القسيمة"
        }
        actions={
          <Link href="/my/payslips">
            <Button variant="secondary">العودة</Button>
          </Link>
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
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums" data-testid="my-payslip-net">
            {formatSar(entry.net_pay)}
          </p>
        </Card>
      </div>

      <p className="mb-4 text-sm text-muted">
        حالة الصرف: <Badge>{entry.payment_status}</Badge>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
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
                >
                  <span>{row.description_ar}</span>
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
                >
                  <span>{row.description_ar}</span>
                  <span className="tabular-nums">{formatSar(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
