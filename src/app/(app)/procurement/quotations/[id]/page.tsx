import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const backLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";
const thClass = "px-3 py-2 text-start font-medium";
const rowClass = "flex justify-between gap-3 border-b border-line pb-2";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "quotation.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: quote } = await supabase
    .from("supplier_quotations")
    .select(
      "*, suppliers(id, supplier_code, legal_name), projects(id, project_code, name_ar, name_en), rfqs(id, rfq_number, title), supplier_quotation_items(*)",
    )
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();

  if (!quote) notFound();

  const { t, locale } = await getI18n();
  const td = t.procurementSourcing.quotations.detail;
  const common = t.procurementSourcing.common;

  const supplier = Array.isArray(quote.suppliers) ? quote.suppliers[0] : quote.suppliers;
  const project = (Array.isArray(quote.projects) ? quote.projects[0] : quote.projects) as
    | { project_code: string; name_ar: string | null; name_en: string | null }
    | null
    | undefined;
  const rfq = Array.isArray(quote.rfqs) ? quote.rfqs[0] : quote.rfqs;
  const items = (quote.supplier_quotation_items as Array<Record<string, unknown>>) ?? [];
  const supplierName = (supplier as Record<string, string> | null)?.legal_name ?? common.none;
  const daysLabel = (value: unknown) =>
    value != null ? format(common.days, { count: String(value) }) : common.none;

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={quote.quotation_number}
        description={format(td.subtitle, { supplier: supplierName })}
        actions={
          rfq ? (
            <Link href={`/procurement/rfqs/${(rfq as Record<string, string>).id}`} className={backLinkClass}>
              {format(common.backTo, { ref: (rfq as Record<string, string>).rfq_number })}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-muted">{td.status}</p>
          <div className="mt-2"><CommercialStatusBadge status={quote.status} locale={locale} /></div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.supplier}</p>
          <p className="mt-2 text-sm font-medium text-ink">{supplierName}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.project}</p>
          <p className="mt-2 text-sm font-medium text-ink">
            {project
              ? format(common.codeName, {
                  code: project.project_code,
                  name: pickLocalized(locale, project.name_ar, project.name_en),
                })
              : common.none}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.quotationDate}</p>
          <p className="mt-2 font-semibold tabular-nums text-ink">{quote.quotation_date}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.commercialTermsTitle}</h2>
          <dl className="grid gap-2 text-sm">
            <div className={rowClass}>
              <dt className="text-muted">{td.validity}</dt>
              <dd className="tabular-nums">{quote.validity_date ?? common.none}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.paymentTerms}</dt>
              <dd>{quote.payment_terms ?? common.none}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.warranty}</dt>
              <dd>{quote.warranty ?? common.none}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.leadTime}</dt>
              <dd className="tabular-nums">{daysLabel(quote.delivery_lead_time_days)}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.totalsTitle}</h2>
          <dl className="grid gap-2 text-sm">
            <div className={rowClass}>
              <dt className="text-muted">{td.subtotal}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={quote.subtotal} currency={quote.currency} locale={locale} /></dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.discount}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={quote.discount} currency={quote.currency} locale={locale} /></dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{format(td.vat, { rate: String(quote.vat_rate_percent) })}</dt>
              <dd className="tabular-nums"><MoneyDisplay amount={quote.vat_amount} currency={quote.currency} locale={locale} /></dd>
            </div>
            <div className="flex justify-between gap-3 pt-1 font-semibold text-ink">
              <dt>{td.grandTotal}</dt>
              <dd className="tabular-nums text-primary"><MoneyDisplay amount={quote.total} currency={quote.currency} locale={locale} /></dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{td.itemsTitle}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{common.noItems}</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className={thClass}>{td.columns.line}</th>
                  <th className={thClass}>{td.columns.description}</th>
                  <th className={thClass}>{td.columns.quantity}</th>
                  <th className="px-3 py-2 text-end font-medium">{td.columns.unitPrice}</th>
                  <th className="px-3 py-2 text-end font-medium">{td.columns.total}</th>
                  <th className={thClass}>{td.columns.brand}</th>
                  <th className={thClass}>{td.columns.model}</th>
                  <th className={thClass}>{td.columns.leadTime}</th>
                  <th className={thClass}>{td.columns.compliance}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums text-muted">{String(item.line_no)}</td>
                    <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                    <td className="px-3 py-2 tabular-nums">{String(item.quantity)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      <MoneyDisplay amount={item.unit_price as number} currency={quote.currency} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end font-medium tabular-nums">
                      <MoneyDisplay amount={item.total_price as number} currency={quote.currency} locale={locale} />
                    </td>
                    <td className="px-3 py-2">{String(item.offered_brand ?? common.none)}</td>
                    <td className="px-3 py-2">{String(item.offered_model ?? common.none)}</td>
                    <td className="px-3 py-2 tabular-nums">{daysLabel(item.lead_time_days)}</td>
                    <td className="px-3 py-2">
                      <CommercialStatusBadge status={String(item.compliance_status ?? "not_assessed")} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {quote.commercial_notes ? (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">{td.notesTitle}</h2>
          <p className="text-sm text-ink">{quote.commercial_notes}</p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
