import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { aggregateCashflowByPeriod, type CashflowLine } from "@/server/domain/commercial";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";

export default async function ProjectCashflowPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "finance.read")) redirect("/projects");

  const { id: projectId } = await params;
  const supabase = await createServerSupabaseClient();
  const coreRepo = new CoreRepository(supabase);
  const repo = new CommercialRepository(supabase);
  const project = await coreRepo.getProject(ctx.organization.id, projectId);
  if (!project) notFound();

  const rawItems = await repo.getProjectCashflowItems(projectId);
  const lines: CashflowLine[] = rawItems.map((item) => ({
    direction: item.direction as "inflow" | "outflow",
    amount: Number(item.amount),
    periodDate: String(item.period_date),
  }));
  const aggregated = aggregateCashflowByPeriod(lines);
  const periods = Object.keys(aggregated).sort();

  const totalInflow = lines
    .filter((l) => l.direction === "inflow")
    .reduce((s, l) => s + l.amount, 0);
  const totalOutflow = lines
    .filter((l) => l.direction === "outflow")
    .reduce((s, l) => s + l.amount, 0);

  return (
    <PageContainer data-testid="project-cashflow-page" className="space-y-5">
      <PageHeader
        title="التدفق النقدي"
        description={`${project.project_code} — توقعات التحصيل والصرف حسب الاستحقاق`}
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/projects/${projectId}/commercial/contract`} className="underline">
              العقد
            </Link>
            <Link href={`/projects/${projectId}/commercial/milestones`} className="underline">
              المراحل
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">إجمالي التحصيل المتوقع</p>
          <p className="mt-2 text-2xl font-bold text-success">
            <MoneyDisplay amount={totalInflow} currency="SAR" />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">إجمالي الصرف المتوقع</p>
          <p className="mt-2 text-2xl font-bold text-danger">
            <MoneyDisplay amount={totalOutflow} currency="SAR" />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">صافي التدفق</p>
          <p className={`mt-2 text-2xl font-bold ${totalInflow - totalOutflow >= 0 ? "text-navy" : "text-danger"}`}>
            <MoneyDisplay amount={totalInflow - totalOutflow} currency="SAR" />
          </p>
        </Card>
      </div>

      {periods.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold text-navy">ملخص شهري</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cashflow-aggregate-table">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">الفترة</th>
                  <th className="py-2 text-right">تحصيل</th>
                  <th className="py-2 text-right">صرف</th>
                  <th className="py-2 text-right">صافي</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const row = aggregated[period];
                  return (
                    <tr key={period} className="border-t border-line">
                      <td className="py-2 font-medium">{period}</td>
                      <td className="py-2 text-success">
                        <MoneyDisplay amount={row.inflow} currency="SAR" />
                      </td>
                      <td className="py-2 text-danger">
                        <MoneyDisplay amount={row.outflow} currency="SAR" />
                      </td>
                      <td className={`py-2 font-medium ${row.net >= 0 ? "text-navy" : "text-danger"}`}>
                        <MoneyDisplay amount={row.net} currency="SAR" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-4 font-semibold text-navy">بنود التدفق</h2>
        {rawItems.length === 0 ? (
          <EmptyState title="لا توجد بنود تدفق نقدي مفتوحة." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cashflow-items-table">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">الاتجاه</th>
                  <th className="py-2 text-right">المصدر</th>
                  <th className="py-2 text-right">تاريخ الاستحقاق</th>
                  <th className="py-2 text-right">المبلغ المتبقي</th>
                  <th className="py-2 text-right">العملة</th>
                </tr>
              </thead>
              <tbody>
                {rawItems.map((item) => (
                  <tr key={`${item.source_type}-${item.source_id}`} className="border-t border-line">
                    <td className="py-2">
                      {item.direction === "inflow" ? "تحصيل" : "صرف"}
                    </td>
                    <td className="py-2">{commercialStatusLabel(String(item.source_type))}</td>
                    <td className="py-2">{String(item.period_date)}</td>
                    <td className="py-2 font-medium">
                      <MoneyDisplay amount={item.amount} currency={item.currency} />
                    </td>
                    <td className="py-2">{item.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
