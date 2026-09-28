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
import { CommercialRepository } from "@/server/repositories/commercial.repository";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier.read")) redirect("/procurement");

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listSuppliers({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="الموردون"
        description="سجل الموردين المعتمدين"
        actions={
          hasPermission(ctx, "supplier.manage") ? (
            <Link
              href="/procurement/suppliers/new"
              className="inline-flex items-center rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + مورد جديد
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <input name="q" defaultValue={params.q} placeholder="اسم أو رمز" className="h-10 rounded-md border px-3 text-sm" />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
            <option value="blocked">محظور</option>
          </select>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "code", header: "الرمز" },
            { key: "name", header: "الاسم القانوني" },
            { key: "city", header: "المدينة" },
            { key: "terms", header: "شروط الدفع" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            code: r.supplier_code,
            name: r.legal_name,
            city: (r as Record<string, unknown>).city ? String((r as Record<string, unknown>).city) : "—",
            terms: `${r.payment_terms_days} يوم`,
            status: <CommercialStatusBadge status={r.status} />,
          }))}
          getRowHref={(row) => `/procurement/suppliers/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/procurement/suppliers"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
