import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { getI18n } from "@/lib/i18n/server";

const STATUS_FILTERS = [
  "draft",
  "under_review",
  "submitted",
  "negotiation",
  "approved",
  "partially_approved",
  "rejected",
  "cancelled",
] as const;

export default async function VariationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const tl = t.financePayables.variations;
  const common = t.financePayables.common;
  const sourceLabel = (source: string) =>
    Object.prototype.hasOwnProperty.call(tl.sources, source)
      ? tl.sources[source as keyof typeof tl.sources]
      : source;

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

  const moneyCell = (amount: number | string | null | undefined) => (
    <span className="block text-end font-medium tabular-nums text-ink">
      <MoneyDisplay amount={amount} currency="SAR" locale={locale} />
    </span>
  );

  return (
    <PageContainer data-testid="variations-page" className="space-y-5">
      <PageHeader
        title={tl.title}
        description={tl.description}
        actions={
          hasPermission(ctx, "variation.create") ? (
            <Link
              href="/finance/variations/new"
              className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover md:min-h-9"
              data-testid="variation-create-link"
            >
              {tl.newVariation}
            </Link>
          ) : null
        }
      />
      <Card>
        <form className="flex flex-wrap items-center gap-3" data-testid="variation-filter-form">
          <Input name="q" defaultValue={params.q} placeholder={tl.searchPlaceholder} className="w-full sm:w-56" />
          <Select name="status" defaultValue={params.status ?? ""} className="w-full sm:w-52">
            <option value="">{common.allStatuses}</option>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {tl.statuses[status]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {common.filter}
          </Button>
        </form>
      </Card>
      <Card className="p-0">
        <RegisterTable
          locale={locale}
          emptyTitle={tl.empty}
          columns={[
            { key: "number", header: tl.columns.number },
            { key: "project", header: tl.columns.project },
            { key: "source", header: tl.columns.source },
            { key: "requested", header: tl.columns.requested, className: "text-end!" },
            { key: "approved", header: tl.columns.approved, className: "text-end!" },
            { key: "status", header: tl.columns.status },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            return {
              id: r.id,
              number: r.vo_number,
              project: (project as Record<string, string> | null)?.project_code ?? common.none,
              source: r.source ? sourceLabel(String(r.source)) : common.none,
              requested: moneyCell(r.requested_amount ?? r.submitted_amount),
              approved:
                r.approved_amount != null ? (
                  moneyCell(r.approved_amount)
                ) : (
                  <span className="block text-end text-muted">{common.none}</span>
                ),
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
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
            locale={locale}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
