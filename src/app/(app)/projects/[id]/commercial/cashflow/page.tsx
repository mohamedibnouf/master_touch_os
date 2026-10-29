import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, EmptyState, PageHeader, StatCard, TableScroll } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { aggregateCashflowByPeriod, type CashflowLine } from "@/server/domain/commercial";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const navLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

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

  const { t, locale } = await getI18n();
  const tf = t.projectCommercial.cashflow;
  const nav = t.projectCommercial.nav;

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
  const net = totalInflow - totalOutflow;

  return (
    <PageContainer data-testid="project-cashflow-page" className="space-y-5">
      <PageHeader
        title={tf.title}
        description={format(tf.subtitle, { code: project.project_code })}
        actions={
          <nav className="flex flex-wrap gap-2">
            <Link href={`/projects/${projectId}/commercial/contract`} className={navLinkClass}>
              {nav.contract}
            </Link>
            <Link href={`/projects/${projectId}/commercial/milestones`} className={navLinkClass}>
              {nav.milestones}
            </Link>
          </nav>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={tf.totalInflow}
          tone="success"
          value={<MoneyDisplay amount={totalInflow} currency="SAR" locale={locale} />}
        />
        <StatCard
          label={tf.totalOutflow}
          tone="danger"
          value={<MoneyDisplay amount={totalOutflow} currency="SAR" locale={locale} />}
        />
        <StatCard
          label={tf.net}
          tone={net >= 0 ? "info" : "danger"}
          value={<MoneyDisplay amount={net} currency="SAR" locale={locale} />}
        />
      </div>

      {periods.length > 0 ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">{tf.monthlyTitle}</h2>
          <TableScroll>
            <table className="w-full text-sm" data-testid="cashflow-aggregate-table">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colPeriod}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colInflow}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colOutflow}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colNet}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const row = aggregated[period];
                  return (
                    <tr key={period} className="border-t border-line">
                      <td className="px-3 py-2.5 font-medium tabular-nums text-ink">{period}</td>
                      <td className="px-3 py-2.5 text-success">
                        <MoneyDisplay amount={row.inflow} currency="SAR" locale={locale} />
                      </td>
                      <td className="px-3 py-2.5 text-danger">
                        <MoneyDisplay amount={row.outflow} currency="SAR" locale={locale} />
                      </td>
                      <td className={`px-3 py-2.5 font-medium ${row.net >= 0 ? "text-primary" : "text-danger"}`}>
                        <MoneyDisplay amount={row.net} currency="SAR" locale={locale} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-ink">{tf.itemsTitle}</h2>
        {rawItems.length === 0 ? (
          <EmptyState title={tf.empty} />
        ) : (
          <TableScroll>
            <table className="w-full text-sm" data-testid="cashflow-items-table">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colDirection}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colSource}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colDueDate}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colOutstanding}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tf.colCurrency}</th>
                </tr>
              </thead>
              <tbody>
                {rawItems.map((item) => (
                  <tr key={`${item.source_type}-${item.source_id}`} className="border-t border-line">
                    <td className={`px-3 py-2.5 font-medium ${item.direction === "inflow" ? "text-success" : "text-danger"}`}>
                      {item.direction === "inflow" ? tf.inflow : tf.outflow}
                    </td>
                    <td className="px-3 py-2.5">{commercialStatusLabel(String(item.source_type), locale)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{String(item.period_date)}</td>
                    <td className="px-3 py-2.5 font-medium">
                      <MoneyDisplay amount={item.amount} currency={item.currency} locale={locale} />
                    </td>
                    <td className="px-3 py-2.5 text-muted">{item.currency}</td>
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
