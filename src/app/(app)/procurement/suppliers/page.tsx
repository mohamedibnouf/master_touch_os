import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button, Card, Input, PageHeader, Select } from "@/components/ui/primitives";
import { RegisterTable } from "@/components/commercial/register-table";
import { RegisterPagination } from "@/components/commercial/pagination";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const STATUSES = ["active", "suspended", "blocked"] as const;

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier.read")) redirect("/procurement");

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const ts = t.procurementOrders.suppliers;

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
        title={ts.title}
        description={ts.description}
        actions={
          hasPermission(ctx, "supplier.manage") ? (
            <Link href="/procurement/suppliers/new">
              <Button type="button">
                <Plus className="size-4" aria-hidden />
                {ts.create}
              </Button>
            </Link>
          ) : null
        }
      />
      <Card className="p-3 md:p-3">
        <form className="grid gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={params.q} placeholder={ts.searchPlaceholder} className="ps-9" />
          </div>
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">{tc.allStatuses}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {commercialStatusLabel(status, locale)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {tc.filter}
          </Button>
        </form>
      </Card>
      <Card className="overflow-hidden p-0 md:p-0">
        <RegisterTable
          locale={locale}
          columns={[
            { key: "code", header: ts.colCode },
            { key: "name", header: ts.colName },
            { key: "city", header: ts.colCity },
            { key: "terms", header: tc.paymentTerms },
            { key: "status", header: tc.status },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            code: (
              <span dir="ltr" className="font-mono text-xs font-semibold text-ink">
                {r.supplier_code}
              </span>
            ),
            name: r.legal_name,
            city: (r as Record<string, unknown>).city ? String((r as Record<string, unknown>).city) : "—",
            terms: format(tc.days, { days: r.payment_terms_days }),
            status: <CommercialStatusBadge status={r.status} locale={locale} />,
          }))}
          getRowHref={(row) => `/procurement/suppliers/${String(row.id)}`}
        />
        <div className="border-t border-line p-4">
          <RegisterPagination
            locale={locale}
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
