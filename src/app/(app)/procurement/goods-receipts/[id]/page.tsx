import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, StatCard, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function GoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "goods_receipt.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const td = t.procurementOrders.receiptDetail;

  const { data: receipt } = await supabase
    .from("goods_receipts")
    .select(
      "*, purchase_orders(id, po_number), suppliers(supplier_code, legal_name), goods_receipt_items(*, purchase_order_items(description, quantity, unit))",
    )
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();

  if (!receipt) notFound();

  const po = Array.isArray(receipt.purchase_orders) ? receipt.purchase_orders[0] : receipt.purchase_orders;
  const supplier = Array.isArray(receipt.suppliers) ? receipt.suppliers[0] : receipt.suppliers;
  const supplierName = (supplier as Record<string, string> | null)?.legal_name ?? "—";
  const items = (receipt.goods_receipt_items as Array<Record<string, unknown>>) ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={receipt.receipt_number}
        description={format(td.subtitle, { supplier: supplierName })}
        actions={
          po ? (
            <Link
              href={`/procurement/purchase-orders/${(po as Record<string, string>).id}`}
              className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              {format(td.poLink, { number: (po as Record<string, string>).po_number })}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label={tc.status} value={<CommercialStatusBadge status={receipt.status} locale={locale} />} />
        <StatCard label={tc.supplier} value={<span className="text-sm font-medium">{supplierName}</span>} />
        <StatCard label={tc.deliveryDate} value={<span className="text-base font-semibold">{receipt.delivery_date}</span>} />
        <StatCard
          label={td.deliveryNoteNumber}
          value={
            <span className="font-mono text-sm" dir="ltr">
              {receipt.delivery_note_number ?? "—"}
            </span>
          }
        />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-ink">{td.lines}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{tc.noItems}</p>
        ) : (
          <TableScroll className="rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{tc.description}</th>
                  <th className="px-3 py-2 text-end font-semibold">{tc.received}</th>
                  <th className="px-3 py-2 text-end font-semibold">{tc.accepted}</th>
                  <th className="px-3 py-2 text-end font-semibold">{tc.rejected}</th>
                  <th className="px-3 py-2 text-start font-semibold">{tc.rejectionReason}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const poItem = Array.isArray(item.purchase_order_items) ? item.purchase_order_items[0] : item.purchase_order_items;
                  return (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">
                        {(poItem as Record<string, unknown> | null)
                          ? String((poItem as Record<string, unknown>).description)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{String(item.received_quantity)}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-success">{String(item.accepted_quantity)}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-danger">{String(item.rejected_quantity)}</td>
                      <td className="px-3 py-2">{item.rejection_reason ? String(item.rejection_reason) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {receipt.notes ? (
        <Card>
          <h2 className="mb-2 font-semibold text-ink">{tc.notes}</h2>
          <p className="text-sm" dir="auto">{receipt.notes}</p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
