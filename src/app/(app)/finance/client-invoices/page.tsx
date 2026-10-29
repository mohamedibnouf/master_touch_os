import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { getI18n } from "@/lib/i18n/server";

const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"] as const;

export default async function ClientInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const ti = t.financeClient.invoices;
  const tc = t.financeClient.common;

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listClientInvoices({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer data-testid="client-invoices-page" className="space-y-5">
      <PageHeader
        title={ti.title}
        description={ti.description}
        actions={
          hasPermission(ctx, "client_invoice.create") ? (
            <Link
              href="/finance/client-invoices/new"
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="client-invoice-create-link"
            >
              {ti.create}
            </Link>
          ) : null
        }
      />
      <Card>
        <form className="flex flex-wrap gap-3" data-testid="client-invoice-filter-form">
          <input
            name="q"
            defaultValue={params.q}
            placeholder={ti.searchPlaceholder}
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
          />
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="">{tc.allStatuses}</option>
            {INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ti.statusOptions[status]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            {tc.filter}
          </button>
        </form>
      </Card>
      <Card className="p-0 md:p-0">
        <RegisterTable
          locale={locale}
          emptyTitle={ti.empty}
          columns={[
            { key: "number", header: ti.colInvoice },
            { key: "client", header: ti.colClient },
            { key: "project", header: ti.colProject },
            { key: "due", header: ti.colDue },
            { key: "total", header: ti.colTotal, className: "text-end!" },
            { key: "status", header: ti.colStatus },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            const contract = Array.isArray(r.project_contracts) ? r.project_contracts[0] : r.project_contracts;
            return {
              id: r.id,
              number: r.invoice_number,
              client: (contract as Record<string, string> | null)?.client_name ?? "—",
              project: (project as Record<string, string> | null)?.project_code ?? "—",
              due: <span className="tabular-nums">{r.due_date ?? "—"}</span>,
              total: (
                <span className="block text-end tabular-nums">
                  <MoneyDisplay amount={r.total} currency={r.currency} locale={locale} />
                </span>
              ),
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/finance/client-invoices/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/finance/client-invoices"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
            locale={locale}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
