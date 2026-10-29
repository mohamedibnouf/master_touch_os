import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterPagination } from "@/components/commercial/pagination";
import { RegisterTable } from "@/components/commercial/register-table";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { newPurchaseRequestHref, parseScopedProjectId } from "@/modules/procurement/stage05-readiness";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; project?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_request.read")) redirect("/procurement");

  const { t, locale } = await getI18n();
  const tl = t.procurementSourcing.requests.list;
  const common = t.procurementSourcing.common;

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const scopedProjectId = parseScopedProjectId(params.project);
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const { rows, total, pageSize } = await repo.listPurchaseRequests({
    organizationId: ctx.organization.id,
    page,
    status: params.status,
    projectId: scopedProjectId ?? undefined,
    search: params.q,
  });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={tl.title}
        description={tl.description}
        actions={
          hasPermission(ctx, "purchase_request.create") ? (
            <Link
              href={newPurchaseRequestHref(scopedProjectId)}
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {tl.newRequest}
            </Link>
          ) : null
        }
      />
      <Card>
        <form className="grid gap-3 md:grid-cols-4">
          <Input name="q" defaultValue={params.q} placeholder={tl.searchPlaceholder} />
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">{common.allStatuses}</option>
            <option value="draft">{tl.statuses.draft}</option>
            <option value="submitted">{tl.statuses.submitted}</option>
            <option value="under_review">{tl.statuses.under_review}</option>
            <option value="approved">{tl.statuses.approved}</option>
            <option value="rejected">{tl.statuses.rejected}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {common.filter}
          </Button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          locale={locale}
          columns={[
            { key: "number", header: tl.columns.number },
            { key: "project", header: tl.columns.project },
            { key: "priority", header: tl.columns.priority },
            { key: "cost", header: tl.columns.cost },
            { key: "status", header: tl.columns.status },
          ]}
          rows={rows.map((r) => {
            const project = (Array.isArray(r.projects) ? r.projects[0] : r.projects) as
              | { project_code: string; name_ar: string | null; name_en?: string | null }
              | null
              | undefined;
            return {
              id: r.id,
              number: r.pr_number,
              project: project
                ? format(common.codeName, {
                    code: project.project_code,
                    name: pickLocalized(locale, project.name_ar, project.name_en),
                  })
                : common.none,
              priority: r.priority ? commercialStatusLabel(r.priority, locale) : common.none,
              cost: <MoneyDisplay amount={r.estimated_cost} currency={r.currency} locale={locale} />,
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/procurement/purchase-requests/${row.id}`}
        />
        <div className="p-4">
          <RegisterPagination
            locale={locale}
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
