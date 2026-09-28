import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "goods_receipt.read")) redirect("/procurement");

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
        title="مستندات استلام البضاعة"
        description="GRN — تسجيل الاستلام مقابل أوامر الشراء"
        actions={
          hasPermission(ctx, "goods_receipt.create") ? (
            <Link
              href="/procurement/goods-receipts/new"
              className="inline-flex items-center rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + استلام جديد
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <input name="q" defaultValue={params.q} placeholder="رقم GRN" className="h-10 rounded-md border px-3 text-sm" />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="received">مستلم</option>
            <option value="partially_accepted">قبول جزئي</option>
            <option value="accepted">مقبول</option>
            <option value="rejected">مرفوض</option>
          </select>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "number", header: "رقم GRN" },
            { key: "po", header: "أمر الشراء" },
            { key: "supplier", header: "المورد" },
            { key: "date", header: "تاريخ التسليم" },
            { key: "status", header: "الحالة" },
          ]}
          rows={(rows ?? []).map((r) => {
            const po = Array.isArray(r.purchase_orders) ? r.purchase_orders[0] : r.purchase_orders;
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            return {
              id: r.id,
              number: r.receipt_number,
              po: (po as Record<string, string> | null)?.po_number ?? "—",
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? "—",
              date: r.delivery_date,
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/procurement/goods-receipts/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
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
