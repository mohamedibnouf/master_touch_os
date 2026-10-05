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

export default async function SupplierInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier_invoice.read")) redirect("/finance");

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
        title="فواتير الموردين"
        description="سجل فواتير AP — مطابقة وصرف"
        actions={
          hasPermission(ctx, "supplier_invoice.create") ? (
            <Link
              href="/finance/supplier-invoices/new"
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + فاتورة جديدة
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <input name="q" defaultValue={params.q} placeholder="رقم الفاتورة" className="h-10 rounded-md border px-3 text-sm" />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="received">مستلمة</option>
            <option value="under_review">قيد المراجعة</option>
            <option value="matched">مطابقة</option>
            <option value="discrepancy">اختلاف</option>
            <option value="approved_for_payment">معتمدة للصرف</option>
            <option value="partially_paid">مدفوعة جزئياً</option>
            <option value="paid">مدفوعة</option>
          </select>
          <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "number", header: "الفاتورة" },
            { key: "supplier", header: "المورد" },
            { key: "due", header: "الاستحقاق" },
            { key: "total", header: "الإجمالي" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
            return {
              id: r.id,
              number: r.invoice_number,
              supplier: (supplier as Record<string, string> | null)?.legal_name ?? "—",
              due: r.due_date ?? "—",
              total: <MoneyDisplay amount={r.total} currency={r.currency} />,
              status: <CommercialStatusBadge status={r.status} />,
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
          />
        </div>
      </Card>
    </PageContainer>
  );
}
