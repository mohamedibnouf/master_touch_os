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
import { getI18n } from "@/lib/i18n/server";

const VALUATION_STATUSES = [
  "draft",
  "internal_review",
  "submitted",
  "under_client_review",
  "certified",
  "partially_certified",
  "rejected",
  "invoiced",
  "paid",
] as const;

export default async function ClientValuationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_valuation.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const tv = t.financeClient.valuations;
  const tc = t.financeClient.common;

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
        title={tv.title}
        description={tv.description}
        actions={
          hasPermission(ctx, "client_valuation.create") ? (
            <Link
              href="/finance/client-valuations/new"
              className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="valuation-create-link"
            >
              {tv.create}
            </Link>
          ) : null
        }
      />
      <Card>
        <form className="flex flex-wrap gap-3" data-testid="valuation-filter-form">
          <input
            name="q"
            defaultValue={params.q}
            placeholder={tv.searchPlaceholder}
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
            data-testid="valuation-search"
          />
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="">{tc.allStatuses}</option>
            {VALUATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {tv.statusOptions[status]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            {tc.filter}
          </button>
        </form>
      </Card>
      <Card className="p-0 md:p-0">
        <RegisterTable
          locale={locale}
          emptyTitle={tv.empty}
          columns={[
            { key: "number", header: tv.colValuation },
            { key: "project", header: tv.colProject },
            { key: "client", header: tv.colClient },
            { key: "claim", header: tv.colClaim, className: "text-end!" },
            { key: "certified", header: tv.colCertified, className: "text-end!" },
            { key: "status", header: tv.colStatus },
          ]}
          rows={rows.map((r) => {
            const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
            const contract = Array.isArray(r.project_contracts) ? r.project_contracts[0] : r.project_contracts;
            return {
              id: r.id,
              number: r.valuation_number,
              project: project ? `${(project as Record<string, string>).project_code}` : "—",
              client: (contract as Record<string, string> | null)?.client_name ?? "—",
              claim: (
                <span className="block text-end tabular-nums">
                  <MoneyDisplay amount={r.total_claim} currency="SAR" locale={locale} />
                </span>
              ),
              certified: (
                <span className="block text-end tabular-nums">
                  {r.certified_amount != null ? (
                    <MoneyDisplay amount={r.certified_amount} currency="SAR" locale={locale} />
                  ) : (
                    "—"
                  )}
                </span>
              ),
              status: <CommercialStatusBadge status={r.status} locale={locale} />,
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
            locale={locale}
          />
        </div>
      </Card>
    </PageContainer>
  );
}
