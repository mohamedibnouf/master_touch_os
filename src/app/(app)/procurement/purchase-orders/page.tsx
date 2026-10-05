import { PageContainer } from "@/components/layout/page-container";
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

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_order.read")) redirect("/procurement");

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
      <PageHeader
        title="أوامر الشراء"
        description="سجل أوامر الشراء الصادرة"
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <input name="q" defaultValue={params.q} placeholder="رقم PO" className="h-10 rounded-md border px-3 text-sm" />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="pending_approval">بانتظار الاعتماد</option>
            <option value="approved">معتمد</option>
            <option value="issued">صادر</option>
            <option value="partially_delivered">تسليم جزئي</option>
            <option value="delivered">مُسلَّم</option>
          </select>
          <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "number", header: "الرقم" },
            { key: "supplier", header: "المورد" },
            { key: "project", header: "المشروع" },
            { key: "total", header: "الإجمالي" },
            { key: "delivery", header: "موعد التسليم" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: r.po_number,
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? "—",
              project: project ? `${(project as Record<string, string>).project_code}` : "—",
              total: <MoneyDisplay amount={r.total} currency={r.currency} />,
              delivery: r.required_delivery_date ?? "—",
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/procurement/purchase-orders/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
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
