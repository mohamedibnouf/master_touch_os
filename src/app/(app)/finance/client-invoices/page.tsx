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

export default async function ClientInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.read")) redirect("/finance");

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
        title="فواتير العملاء"
        description="سجل فواتير AR — إصدار وتحصيل"
        actions={
          hasPermission(ctx, "client_invoice.create") ? (
            <Link
              href="/finance/client-invoices/new"
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="client-invoice-create-link"
            >
              + فاتورة جديدة
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" data-testid="client-invoice-filter-form">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="رقم الفاتورة"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="issued">صادرة</option>
            <option value="partially_paid">مدفوعة جزئياً</option>
            <option value="paid">مدفوعة</option>
            <option value="overdue">متأخرة</option>
            <option value="cancelled">ملغاة</option>
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
            { key: "client", header: "العميل" },
            { key: "project", header: "المشروع" },
            { key: "due", header: "الاستحقاق" },
            { key: "total", header: "الإجمالي" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            const contract = Array.isArray(r.project_contracts) ? r.project_contracts[0] : r.project_contracts;
            return {
              id: r.id,
              number: r.invoice_number,
              client: (contract as Record<string, string> | null)?.client_name ?? "—",
              project: (project as Record<string, string> | null)?.project_code ?? "—",
              due: r.due_date ?? "—",
              total: <MoneyDisplay amount={r.total} currency={r.currency} />,
              status: <CommercialStatusBadge status={r.status} />,
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
          />
        </div>
      </Card>
    </PageContainer>
  );
}
