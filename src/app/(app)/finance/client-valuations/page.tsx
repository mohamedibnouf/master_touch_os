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

export default async function ClientValuationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_valuation.read")) redirect("/finance");

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listClientValuations({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer data-testid="client-valuations-page" className="space-y-5">
      <PageHeader
        title="مستخلصات العميل"
        description="سجل مستخلصات AR — من المطالبة إلى التصديق"
        actions={
          hasPermission(ctx, "client_valuation.create") ? (
            <Link
              href="/finance/client-valuations/new"
              className="inline-flex items-center rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="valuation-create-link"
            >
              + مستخلص جديد
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" data-testid="valuation-filter-form">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="رقم المستخلص"
            className="h-10 rounded-md border px-3 text-sm"
            data-testid="valuation-search"
          />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="internal_review">مراجعة داخلية</option>
            <option value="submitted">مقدّم</option>
            <option value="under_client_review">قيد مراجعة العميل</option>
            <option value="certified">معتمد</option>
            <option value="partially_certified">معتمد جزئياً</option>
            <option value="rejected">مرفوض</option>
            <option value="invoiced">مفوتر</option>
            <option value="paid">مدفوع</option>
          </select>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "number", header: "المستخلص" },
            { key: "project", header: "المشروع" },
            { key: "client", header: "العميل" },
            { key: "claim", header: "المطالبة" },
            { key: "certified", header: "المعتمد" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            const contract = Array.isArray(r.project_contracts) ? r.project_contracts[0] : r.project_contracts;
            return {
              id: r.id,
              number: r.valuation_number,
              project: project
                ? `${(project as Record<string, string>).project_code}`
                : "—",
              client: (contract as Record<string, string> | null)?.client_name ?? "—",
              claim: <MoneyDisplay amount={r.total_claim} currency="SAR" />,
              certified: r.certified_amount != null ? (
                <MoneyDisplay amount={r.certified_amount} currency="SAR" />
              ) : (
                "—"
              ),
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/finance/client-valuations/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/finance/client-valuations"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
