import { todayInRiyadh } from "@/lib/time/riyadh";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, Section, StatCard, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { remainingBalance, roundMoney } from "@/server/domain/commercial";
import { sumByCurrency } from "@/modules/procurement/integrity";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

type AgeBucket = "CURRENT" | "1-30" | "31-60" | "61-90" | "90+";

const AGE_BUCKETS: AgeBucket[] = ["CURRENT", "1-30", "31-60", "61-90", "90+"];

function ageBucket(dueDate: string | null, today: string): AgeBucket {
  if (!dueDate || dueDate >= today) return "CURRENT";
  const daysPast = Math.floor(
    (Date.parse(today) - Date.parse(dueDate)) / (1000 * 60 * 60 * 24),
  );
  if (daysPast <= 30) return "1-30";
  if (daysPast <= 60) return "31-60";
  if (daysPast <= 90) return "61-90";
  return "90+";
}

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "finance.read") && !hasPermission(ctx, "client_invoice.read")) {
    redirect("/finance");
  }

  const { t, locale } = await getI18n();
  const tr = t.financeClient.receivables;
  const bucketLabels: Record<AgeBucket, string> = tr.buckets;

  const params = await searchParams;
  const today = todayInRiyadh();
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const rows = await repo.listReceivables(ctx.organization.id);

  const items = rows.map((inv) => {
    const payments = (inv.client_payments as Array<{ amount: number }>) ?? [];
    const paid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
    const outstanding = remainingBalance(Number(inv.total), paid);
    const bucket = ageBucket(inv.due_date, today);
    const project = Array.isArray(inv.projects) ? inv.projects[0] : inv.projects;
    const contract = Array.isArray(inv.project_contracts) ? inv.project_contracts[0] : inv.project_contracts;
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      client: (contract as Record<string, string> | null)?.client_name ?? "—",
      project: (project as Record<string, string> | null)?.project_code ?? "—",
      dueDate: inv.due_date,
      total: Number(inv.total),
      outstanding,
      currency: inv.currency,
      status: inv.status,
      bucket,
    };
  }).filter((i) => i.outstanding > 0);

  // Amounts are totalled per currency — invoices in different currencies are never added together.
  const bucketTotals = Object.fromEntries(
    AGE_BUCKETS.map((bucket) => {
      const inBucket = items.filter((item) => item.bucket === bucket);
      return [
        bucket,
        {
          count: inBucket.length,
          amounts: sumByCurrency(inBucket.map((item) => ({ currency: item.currency, amount: item.outstanding }))),
        },
      ];
    }),
  ) as Record<AgeBucket, { count: number; amounts: Array<{ currency: string; amount: number }> }>;

  const filtered = params.bucket
    ? items.filter((i) => i.bucket === params.bucket)
    : items;

  return (
    <PageContainer data-testid="receivables-page" className="space-y-5">
      <PageHeader
        title={tr.title}
        description={tr.description}
        actions={
          <Link href="/finance" className="text-sm font-medium text-primary hover:underline">
            {tr.financeLink}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {AGE_BUCKETS.map((bucket) => (
          <Link
            key={bucket}
            href={`/finance/receivables?bucket=${bucket}`}
            className={`block rounded-xl transition hover:opacity-90 ${params.bucket === bucket ? "ring-2 ring-primary/40" : ""}`}
          >
            <div data-testid={`receivables-bucket-${bucket}`}>
              <StatCard
                label={bucketLabels[bucket]}
                tone={bucket === "CURRENT" ? "info" : bucket === "1-30" ? "warning" : "danger"}
                value={
                  bucketTotals[bucket].amounts.length === 0 ? (
                    <span className="text-lg">
                      <MoneyDisplay amount={0} currency="SAR" locale={locale} />
                    </span>
                  ) : (
                    <span className="flex flex-col text-lg">
                      {bucketTotals[bucket].amounts.map((total) => (
                        <MoneyDisplay key={total.currency} amount={total.amount} currency={total.currency} locale={locale} />
                      ))}
                    </span>
                  )
                }
                hint={format(tr.invoiceCount, { count: bucketTotals[bucket].count })}
              />
            </div>
          </Link>
        ))}
      </div>

      <Section
        title={params.bucket ? bucketLabels[params.bucket as AgeBucket] ?? tr.all : tr.allOpen}
        actions={
          params.bucket ? (
            <Link href="/finance/receivables" className="text-sm font-medium text-primary hover:underline">
              {tr.showAll}
            </Link>
          ) : null
        }
      >
        {filtered.length === 0 ? (
          <EmptyState title={tr.empty} />
        ) : (
          <TableScroll>
            <table className="w-full text-sm" data-testid="receivables-table">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colInvoice}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colClient}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colProject}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colDue}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{tr.colOutstanding}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colBucket}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{tr.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-3 py-2.5">
                      <Link href={`/finance/client-invoices/${item.id}`} className="font-medium text-primary hover:underline">
                        {item.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-ink">{item.client}</td>
                    <td className="px-3 py-2.5 text-muted">{item.project}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted">{item.dueDate ?? "—"}</td>
                    <td className="px-3 py-2.5 text-end font-medium tabular-nums text-danger">
                      <MoneyDisplay amount={item.outstanding} currency={item.currency} locale={locale} />
                    </td>
                    <td className="px-3 py-2.5 text-muted">{bucketLabels[item.bucket]}</td>
                    <td className="px-3 py-2.5">
                      <CommercialStatusBadge status={item.status} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Section>
    </PageContainer>
  );
}
