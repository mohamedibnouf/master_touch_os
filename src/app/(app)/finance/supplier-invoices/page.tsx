import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { getI18n } from "@/lib/i18n/server";

const STATUS_FILTERS = [
  "received",
  "under_review",
  "matched",
  "discrepancy",
  "approved_for_payment",
  "partially_paid",
  "paid",
] as const;

export default async function SupplierInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier_invoice.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const tl = t.financePayables.supplierInvoices;
  const common = t.financePayables.common;

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listSupplierInvoices({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={tl.title}
        description={tl.description}
        actions={
          hasPermission(ctx, "supplier_invoice.create") ? (
            <Link
              href="/finance/supplier-invoices/new"
              className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover md:min-h-9"
            >
              {tl.newInvoice}
            </Link>
          ) : null
        }
      />
      <Card>
        <form className="flex flex-wrap items-center gap-3">
          <Input name="q" defaultValue={params.q} placeholder={tl.searchPlaceholder} className="w-full sm:w-56" />
          <Select name="status" defaultValue={params.status ?? ""} className="w-full sm:w-52">
            <option value="">{common.allStatuses}</option>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {tl.statuses[status]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {common.filter}
          </Button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          locale={locale}
          emptyTitle={tl.empty}
          columns={[
            { key: "number", header: tl.columns.number },
            { key: "supplier", header: tl.columns.supplier },
            { key: "due", header: tl.columns.due },
            { key: "total", header: tl.columns.total, className: "text-end!" },
            { key: "status", header: tl.columns.status },
          ]}
          rows={rows.map((r) => {
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            return {
              id: r.id,
              number: r.invoice_number,
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? common.none,
              due: <span className="tabular-nums">{r.due_date ?? common.none}</span>,
              total: (
                <span className="block text-end font-medium tabular-nums text-ink">
                  <MoneyDisplay amount={r.total} currency={r.currency} locale={locale} />
                </span>
              ),
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/finance/supplier-invoices/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/finance/supplier-invoices"
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
