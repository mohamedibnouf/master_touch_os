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

export default async function RfqsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "rfq.read")) redirect("/procurement");

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listRfqs({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="طلبات عروض الأسعار"
        description="RFQ — إرسال طلبات الأسعار للموردين"
        actions={
          hasPermission(ctx, "rfq.create") ? (
            <Link href="/procurement/rfqs/new" className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
              + طلب عرض أسعار
            </Link>
          ) : null
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="رقم أو عنوان"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border px-3 text-sm">
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="ready_to_issue">جاهز للإصدار</option>
            <option value="issued">صادر</option>
            <option value="responses_received">وردت الردود</option>
            <option value="under_comparison">قيد المقارنة</option>
            <option value="awarded">مرسّى</option>
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
            { key: "title", header: "العنوان" },
            { key: "project", header: "المشروع" },
            { key: "due", header: "موعد الرد" },
            { key: "status", header: "الحالة" },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: r.rfq_number,
              title: r.title,
              project: project ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}` : "—",
              due: r.response_due_date ?? "—",
              status: <CommercialStatusBadge status={r.status} />,
            };
          })}
          getRowHref={(row) => `/procurement/rfqs/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            basePath="/procurement/rfqs"
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            params={{ status: params.status, q: params.q }}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
