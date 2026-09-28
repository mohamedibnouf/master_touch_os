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

export default async function VariationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.read")) redirect("/finance");

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listVariations({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer data-testid="variations-page" className="space-y-5">
      <PageHeader
        title="أوامر التغيير"
        description="سجل VO — من الطلب إلى الاعتماد"
        actions={
          hasPermission(ctx, "variation.create") ? (
            <Link
              href="/finance/variations/new"
              className="inline-flex items-center rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="variation-create-link"
            >
              + أمر تغيير جديد
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3" data-testid="variation-filter-form">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="رقم VO"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="under_review">قيد المراجعة</option>
            <option value="submitted">مقدّم</option>
            <option value="negotiation">تفاوض</option>
            <option value="approved">معتمد</option>
            <option value="partially_approved">معتمد جزئياً</option>
            <option value="rejected">مرفوض</option>
            <option value="cancelled">ملغى</option>
          </select>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            تصفية
          </button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          columns={[
            { key: "number", header: "VO" },
            { key: "project", header: "المشروع" },
            { key: "source", header: "المصدر" },
            { key: "requested", header: "المطلوب" },
            { key: "approved", header: "المعتمد" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: r.vo_number,
              project: (project as Record<string, string> | null)?.project_code ?? "—",
              source: r.source ?? "—",
              requested: <MoneyDisplay amount={r.requested_amount ?? r.submitted_amount} currency="SAR" />,
              approved: r.approved_amount != null ? (
                <MoneyDisplay amount={r.approved_amount} currency="SAR" />
              ) : (
                "—"
              ),
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/finance/variations/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/finance/variations"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
