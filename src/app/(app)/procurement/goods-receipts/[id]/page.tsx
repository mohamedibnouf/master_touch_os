import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function GoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "goods_receipt.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

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
  const items = (receipt.goods_receipt_items as Array<Record<string, unknown>>) ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={receipt.receipt_number}
        description={`استلام بضاعة — ${(supplier as Record<string, string> | null)?.legal_name ?? "—"}`}
        actions={
          po ? (
            <Link href={`/procurement/purchase-orders/${(po as Record<string, string>).id}`} className="text-sm underline">
              أمر الشراء: {(po as Record<string, string>).po_number}
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={receipt.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المورد</p>
          <p className="mt-2 text-sm font-medium">{(supplier as Record<string, string> | null)?.legal_name ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">تاريخ التسليم</p>
          <p className="mt-2 font-semibold">{receipt.delivery_date}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">رقم مذكرة التسليم</p>
          <p className="mt-2 text-sm">{receipt.delivery_note_number ?? "—"}</p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">تفاصيل الاستلام</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">لا توجد بنود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper text-right text-muted">
                <tr>
                  <th className="px-3 py-2">الوصف</th>
                  <th className="px-3 py-2">المستلم</th>
                  <th className="px-3 py-2">المقبول</th>
                  <th className="px-3 py-2">المرفوض</th>
                  <th className="px-3 py-2">سبب الرفض</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const poItem = Array.isArray(item.purchase_order_items) ? item.purchase_order_items[0] : item.purchase_order_items;
                  return (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2">
                        {(poItem as Record<string, unknown> | null)
                          ? String((poItem as Record<string, unknown>).description)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{String(item.received_quantity)}</td>
                      <td className="px-3 py-2 tabular-nums text-success">{String(item.accepted_quantity)}</td>
                      <td className="px-3 py-2 tabular-nums text-danger">{String(item.rejected_quantity)}</td>
                      <td className="px-3 py-2">{item.rejection_reason ? String(item.rejection_reason) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {receipt.notes ? (
        <Card>
          <h2 className="mb-2 font-semibold text-navy">ملاحظات</h2>
          <p className="text-sm">{receipt.notes}</p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
