import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, TableScroll } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { getI18n } from "@/lib/i18n/server";
import { pickLocalized } from "@/lib/i18n/config";
import { approvalTitleColumns, selectWithOptionalTitleEn } from "@/lib/approvals/title-en";

const navLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

export default async function FinancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const canAp = hasPermission(ctx, "supplier_invoice.read");
  const canAr = hasPermission(ctx, "client_invoice.read") || hasPermission(ctx, "finance.read");
  const canPay = hasPermission(ctx, "client_payment.record");
  if (!canAp && !canAr && !canPay) redirect("/");

  const { t, locale } = await getI18n();
  const td = t.financeClient.dashboard;
  const approvalStatusLabels: Record<string, string> = td.approvalStatus;

  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const stats = await repo.financeDashboardStats(ctx.organization.id);

  const [supplierInvoices, clientInvoices, approvals] = await Promise.all([
    canAp
      ? supabase
          .from("supplier_invoices")
          .select("id, invoice_number, total, currency, due_date, status, project_id")
          .eq("organization_id", ctx.organization.id)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    canAr
      ? supabase
          .from("client_invoices")
          .select("id, invoice_number, total, currency, due_date, status")
          .eq("organization_id", ctx.organization.id)
          .in("status", ["issued", "partially_paid", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    selectWithOptionalTitleEn((withTitleEn) =>
      supabase
        .from("approval_requests")
        .select(approvalTitleColumns("id, title, status, due_at, entity_type", withTitleEn))
        .eq("organization_id", ctx.organization.id)
        .in("status", ["pending", "in_progress"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20)
        .returns<
          Array<{ id: string; title: string; title_en?: string | null; status: string; due_at: string | null; entity_type: string }>
        >(),
    ),
  ]);

  return (
    <PageContainer data-testid="finance-dashboard-page" className="space-y-5">
      <PageHeader
        title={td.title}
        description={td.description}
        actions={
          <nav className="flex flex-wrap gap-2">
            {canAp ? (
              <Link href="/finance/supplier-invoices" className={navLinkClass}>
                {td.navSupplierInvoices}
              </Link>
            ) : null}
            {hasPermission(ctx, "client_valuation.read") ? (
              <Link href="/finance/client-valuations" className={navLinkClass} data-testid="nav-client-valuations">
                {td.navClientValuations}
              </Link>
            ) : null}
            {canAr ? (
              <Link href="/finance/client-invoices" className={navLinkClass} data-testid="nav-client-invoices">
                {td.navClientInvoices}
              </Link>
            ) : null}
            {hasPermission(ctx, "variation.read") ? (
              <Link href="/finance/variations" className={navLinkClass} data-testid="nav-variations">
                {td.navVariations}
              </Link>
            ) : null}
            {canAr ? (
              <Link href="/finance/receivables" className={navLinkClass} data-testid="nav-receivables">
                {td.navReceivables}
              </Link>
            ) : null}
            <Link href="/procurement" className={navLinkClass}>
              {td.navProcurement}
            </Link>
          </nav>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canAp ? (
          <>
            <div data-testid="stat-due-in-7">
              <StatCard label={td.statDueIn7} value={stats.dueIn7} />
            </div>
            <div data-testid="stat-overdue-ap">
              <StatCard label={td.statOverdueAp} value={stats.overdueAp} tone="danger" />
            </div>
            <div data-testid="stat-approved-payment">
              <StatCard label={td.statApprovedForPayment} value={stats.approvedForPayment} tone="warning" />
            </div>
          </>
        ) : null}
        {canAr ? (
          <>
            <div data-testid="stat-outstanding-ar">
              <StatCard label={td.statOutstandingAr} value={stats.outstandingAr} tone="info" />
            </div>
            <div data-testid="stat-overdue-ar">
              <StatCard label={td.statOverdueAr} value={stats.overdueAr} tone="danger" />
            </div>
            <Card>
              <p className="text-xs font-medium text-muted">{td.statAging}</p>
              <Link
                href="/finance/receivables"
                className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                {td.viewAging}
              </Link>
            </Card>
          </>
        ) : null}
        {canAp ? (
          <div data-testid="stat-discrepancies">
            <StatCard label={td.statDiscrepancies} value={stats.discrepancies} tone="warning" />
          </div>
        ) : null}
      </div>

      {canAp ? (
        <Section title={td.openSupplierInvoices}>
          {(supplierInvoices.data ?? []).length === 0 ? (
            <EmptyState title={td.noOpenInvoices} />
          ) : (
            <TableScroll>
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-start font-medium">{td.colInvoiceNumber}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{td.colAmount}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{td.colDue}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{td.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {(supplierInvoices.data ?? []).map((inv) => (
                    <tr key={inv.id} className="border-t border-line">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/finance/supplier-invoices/${inv.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums">
                        <MoneyDisplay amount={inv.total} currency={inv.currency} locale={locale} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted">{inv.due_date ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone="navy">{commercialStatusLabel(inv.status, locale)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {canAr ? (
          <Section
            title={td.dueClientInvoices}
            actions={
              <Link href="/finance/receivables" className="text-sm font-medium text-primary hover:underline">
                {td.receivablesLink}
              </Link>
            }
          >
            {(clientInvoices.data ?? []).length === 0 ? (
              <EmptyState title={td.noOpenReceivables} />
            ) : (
              <ul className="space-y-2 text-sm">
                {(clientInvoices.data ?? []).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 border-b border-line pb-2">
                    <Link
                      href={`/finance/client-invoices/${inv.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {inv.invoice_number}
                    </Link>
                    <span className="text-end tabular-nums">
                      <MoneyDisplay amount={inv.total} currency={inv.currency} locale={locale} />
                      <span className="text-muted"> · {inv.due_date ?? "—"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
        <Section title={td.pendingApprovals}>
          {(approvals.data ?? []).length === 0 ? (
            <EmptyState title={td.noPendingApprovals} />
          ) : (
            <ul className="space-y-2 text-sm">
              {(approvals.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line pb-2">
                  <span className="text-ink">{pickLocalized(locale, a.title, a.title_en) || a.title}</span>
                  <Badge tone="warning">
                    {approvalStatusLabels[a.status] ?? commercialStatusLabel(a.status, locale)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PageContainer>
  );
}
