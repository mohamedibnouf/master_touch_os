import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function RfqsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "rfq.read")) redirect("/procurement");

  const { t, locale } = await getI18n();
  const tl = t.procurementSourcing.rfqs.list;
  const common = t.procurementSourcing.common;

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
        title={tl.title}
        description={tl.description}
        actions={
          hasPermission(ctx, "rfq.create") ? (
            <Link
              href="/procurement/rfqs/new"
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {tl.newRfq}
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
            <option value="ready_to_issue">{tl.statuses.ready_to_issue}</option>
            <option value="issued">{tl.statuses.issued}</option>
            <option value="responses_received">{tl.statuses.responses_received}</option>
            <option value="under_comparison">{tl.statuses.under_comparison}</option>
            <option value="awarded">{tl.statuses.awarded}</option>
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
            { key: "title", header: tl.columns.title },
            { key: "project", header: tl.columns.project },
            { key: "due", header: tl.columns.due },
            { key: "status", header: tl.columns.status },
          ]}
          rows={rows.map((r) => {
            const project = (Array.isArray(r.projects) ? r.projects[0] : r.projects) as
              | { project_code: string; name_ar: string | null; name_en?: string | null }
              | null
              | undefined;
            return {
              id: r.id,
              number: r.rfq_number,
              title: r.title,
              project: project
                ? format(common.codeName, {
                    code: project.project_code,
                    name: pickLocalized(locale, project.name_ar, project.name_en),
                  })
                : common.none,
              due: r.response_due_date ?? common.none,
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
            };
          })}
          getRowHref={(row) => `/procurement/rfqs/${String(row.id)}`}
        />
        <div className="p-4">
          <RegisterPagination
            locale={locale}
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
