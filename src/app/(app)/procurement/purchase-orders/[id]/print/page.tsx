import { PageContainer } from "@/components/layout/page-container";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { MoneyDisplay } from "@/components/commercial/money";
import { dirFor, format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function PurchaseOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_order.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const po = await repo.getPurchaseOrder(id);
  if (!po) notFound();

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const tp = t.procurementOrders.print;

  const supplier = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
  const project = Array.isArray(po.projects) ? po.projects[0] : po.projects;
  const items = (po.purchase_order_items as Array<Record<string, unknown>>) ?? [];

  const s = supplier as Record<string, string> | null;
  const prj = project as Record<string, string | null> | null;

  const detailRow = (label: string, value: string) => (
    <div className="flex gap-2 text-sm">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );

  return (
    <PageContainer className="mx-auto max-w-3xl print:mx-0 print:max-w-none">
      {/* Print button */}
      <div className="mb-6 print:hidden">
        <button
          id="po-print-button"
          type="button"
          onClick={undefined}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90"
          suppressHydrationWarning
        >
          {tp.printButton}
        </button>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){var b=document.getElementById('po-print-button');if(b){b.onclick=function(){window.print();};}})();`,
          }}
        />
      </div>

      {/* PO Document — follows the active language direction */}
      <article
        dir={dirFor(locale)}
        lang={locale}
        className="mt-force-light rounded-lg border border-line bg-surface p-8 text-ink print:rounded-none print:border-0 print:p-0"
      >
        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-primary pb-6">
          <div dir="ltr" className="text-start">
            <h1 className="text-2xl font-bold text-ink">MASTER TOUCH</h1>
            <p className="text-sm text-muted">General Contracting & Smart Systems</p>
          </div>
          <div className="text-end">
            <h2 className="text-xl font-bold text-ink">{tp.title}</h2>
            <p className="mt-1 font-mono text-lg font-semibold" dir="ltr">
              {po.po_number}
            </p>
            {po.issue_date ? (
              <p className="text-sm text-muted">
                {tp.issueDate}: <span dir="ltr">{po.issue_date}</span>
              </p>
            ) : null}
          </div>
        </header>

        {/* Parties */}
        <div className="mb-6 grid gap-6 md:grid-cols-2 print:grid-cols-2">
          <section>
            <h3 className="mb-2 font-semibold text-ink">{tp.supplierInfo}</h3>
            <p className="font-medium" dir="auto">{s?.legal_name ?? "—"}</p>
            {s?.trade_name ? <p className="text-sm text-muted" dir="auto">{s.trade_name}</p> : null}
            {s?.email ? <p className="text-sm" dir="ltr">{s.email}</p> : null}
            {s?.phone ? <p className="text-sm" dir="ltr">{s.phone}</p> : null}
          </section>
          <section>
            <h3 className="mb-2 font-semibold text-ink">{tp.orderDetails}</h3>
            <dl className="space-y-0.5">
              {detailRow(
                tc.project,
                prj ? `${prj.project_code} — ${pickLocalized(locale, prj.name_ar, prj.name_en)}` : "—",
              )}
              {po.required_delivery_date ? detailRow(tc.requiredDelivery, po.required_delivery_date) : null}
              {po.payment_terms ? detailRow(tc.paymentTerms, po.payment_terms) : null}
              {po.delivery_terms ? detailRow(tc.deliveryTerms, po.delivery_terms) : null}
              {po.delivery_address ? detailRow(tc.deliveryAddress, po.delivery_address) : null}
            </dl>
          </section>
        </div>

        {/* Line items */}
        <table className="mb-6 w-full text-sm">
          <thead>
            <tr className="bg-primary text-white print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
              <th className="px-3 py-2 text-start">#</th>
              <th className="px-3 py-2 text-start">{tc.description}</th>
              <th className="px-3 py-2 text-end">{tc.quantity}</th>
              <th className="px-3 py-2 text-start">{tc.unit}</th>
              <th className="px-3 py-2 text-end">{tc.unitPrice}</th>
              <th className="px-3 py-2 text-end">{tc.total}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={String(item.id)} className="border-b border-line">
                <td className="px-3 py-2">{String(item.line_no)}</td>
                <td className="px-3 py-2" dir="auto">{String(item.description)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{String(item.quantity)}</td>
                <td className="px-3 py-2">{String(item.unit ?? "—")}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  <MoneyDisplay amount={item.unit_price as number} currency={po.currency} locale={locale} />
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  <MoneyDisplay amount={item.line_total as number} currency={po.currency} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={5} className="px-3 py-2 text-end font-medium text-muted">{tc.subtotal}</td>
              <td className="px-3 py-2 text-end font-medium tabular-nums">
                <MoneyDisplay amount={po.subtotal} currency={po.currency} locale={locale} />
              </td>
            </tr>
            {Number(po.discount) > 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-end text-muted">{tc.discount}</td>
                <td className="px-3 py-2 text-end tabular-nums text-danger">
                  - <MoneyDisplay amount={po.discount} currency={po.currency} locale={locale} />
                </td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={5} className="px-3 py-2 text-end text-muted">
                {format(tc.vatWithRate, { rate: po.vat_rate_percent })}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                <MoneyDisplay amount={po.vat_amount} currency={po.currency} locale={locale} />
              </td>
            </tr>
            <tr className="bg-surface-muted font-bold print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
              <td colSpan={5} className="px-3 py-3 text-end text-ink">{tc.grandTotal}</td>
              <td className="px-3 py-3 text-end tabular-nums text-ink">
                <MoneyDisplay amount={po.total} currency={po.currency} locale={locale} />
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <footer className="mt-8 border-t border-line pt-6 text-xs text-muted">
          <p>{tp.footer}</p>
          <p className="mt-1">
            {tp.issuedAt}: {po.issued_at ? new Date(po.issued_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" }) : "—"}
          </p>
        </footer>
      </article>
    </PageContainer>
  );
}
