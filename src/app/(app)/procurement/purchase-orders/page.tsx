import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { getI18n } from "@/lib/i18n/server";

const STATUSES = ["draft", "pending_approval", "approved", "issued", "partially_delivered", "delivered"] as const;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_order.read")) redirect("/procurement");

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const to = t.procurementOrders.orders;

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listPurchaseOrders({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader title={to.title} description={to.description} />
      <Card className="p-3 md:p-3">
        <form className="grid gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={params.q} placeholder={to.searchPlaceholder} className="ps-9" />
          </div>
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">{tc.allStatuses}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {commercialStatusLabel(status, locale)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {tc.filter}
          </Button>
        </form>
      </Card>
      <Card className="overflow-hidden p-0 md:p-0">
        <RegisterTable
          locale={locale}
          columns={[
            { key: "number", header: tc.number },
            { key: "supplier", header: tc.supplier },
            { key: "project", header: tc.project },
            { key: "total", header: tc.total },
            { key: "delivery", header: tc.requiredDelivery },
            { key: "status", header: tc.status },
          ]}
          rows={rows.map((r) => {
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: (
                <span dir="ltr" className="font-mono text-xs font-semibold text-ink">
                  {r.po_number}
                </span>
              ),
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? "—",
              project: project ? (
                <span dir="ltr" className="font-mono text-xs">
                  {(project as Record<string, string>).project_code}
                </span>
              ) : (
                "—"
              ),
              total: <MoneyDisplay amount={r.total} currency={r.currency} locale={locale} />,
              delivery: r.required_delivery_date ?? "—",
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/procurement/purchase-orders/${String(row.id)}`}
        />
        <div className="border-t border-line p-4">
          <RegisterPagination
            locale={locale}
            basePath="/procurement/purchase-orders"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
