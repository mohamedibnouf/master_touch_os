import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { RegisterPagination } from "@/components/commercial/pagination";
import { RegisterTable } from "@/components/commercial/register-table";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";

export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; project?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_request.read")) redirect("/procurement");

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listPurchaseRequests({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    projectId: params.project,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="طلبات الشراء"
        description="سجل طلبات الشراء الداخلية"
        actions={
          hasPermission(ctx, "purchase_request.create") ? (
            <Link href="/procurement/purchase-requests/new" className="text-sm text-navy underline">
              طلب جديد
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-4">
          <input name="q" defaultValue={params.q} placeholder="رقم PR" className="h-10 rounded-md border px-3 text-sm" />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="submitted">مقدّم</option>
            <option value="under_review">قيد المراجعة</option>
            <option value="approved">معتمد</option>
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
            { key: "number", header: "الرقم" },
            { key: "project", header: "المشروع" },
            { key: "priority", header: "الأولوية" },
            { key: "cost", header: "التكلفة" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: r.pr_number,
              project: project ? `${project.project_code} — ${project.name_ar}` : "—",
              priority: r.priority,
              cost: <MoneyDisplay amount={r.estimated_cost} currency={r.currency} />,
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/procurement/purchase-requests/${row.id}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/procurement/purchase-requests"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q, project: params.project }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
