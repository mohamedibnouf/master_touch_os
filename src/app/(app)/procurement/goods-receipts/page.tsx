import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { getI18n } from "@/lib/i18n/server";

const STATUSES = ["draft", "received", "partially_accepted", "accepted", "rejected"] as const;

export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "goods_receipt.read")) redirect("/procurement");

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const tr = t.procurementOrders.receipts;

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const supabase = await createServerSupabaseClient();

  let q = supabase
    .from("goods_receipts")
    .select(
      "id, receipt_number, status, delivery_date, purchase_order_id, purchase_orders(po_number), suppliers(legal_name)",
      { count: "exact" },
    )
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (params.status) q = q.eq("status", params.status);
  if (params.q) q = q.ilike("receipt_number", `%${params.q}%`);

  const { data: rows, count } = await q;

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={tr.title}
        description={tr.description}
        actions={
          hasPermission(ctx, "goods_receipt.create") ? (
            <Link href="/procurement/goods-receipts/new">
              <Button type="button">
                <Plus className="size-4" aria-hidden />
                {tr.create}
              </Button>
            </Link>
          ) : null
        }
      />
      <Card className="p-3 md:p-3">
        <form className="grid gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={params.q} placeholder={tr.searchPlaceholder} className="ps-9" />
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
            { key: "number", header: tr.colNumber },
            { key: "po", header: tc.purchaseOrder },
            { key: "supplier", header: tc.supplier },
            { key: "date", header: tc.deliveryDate },
            { key: "status", header: tc.status },
          ]}
          rows={(rows ?? []).map((r) => {
            const po = Array.isArray(r.purchase_orders) ? r.purchase_orders[0] : r.purchase_orders;
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            const poNumber = (po as Record<string, string> | null)?.po_number;
            return {
              id: r.id,
              number: (
                <span dir="ltr" className="font-mono text-xs font-semibold text-ink">
                  {r.receipt_number}
                </span>
              ),
              po: poNumber ? (
                <span dir="ltr" className="font-mono text-xs">
                  {poNumber}
                </span>
              ) : (
                "—"
              ),
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? "—",
              date: r.delivery_date,
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/procurement/goods-receipts/${String(row.id)}`}
        />
        <div className="border-t border-line p-4">
          <RegisterPagination
            locale={locale}
            basePath="/procurement/goods-receipts"
            page={page}
            totalPages={Math.max(1, Math.ceil((count ?? 0) / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
