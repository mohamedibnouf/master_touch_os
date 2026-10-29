import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createPoFromQuotationAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ quotationId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "purchase_order.create");
  const { quotationId } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const tf = t.procurementOrders.orderForm;

  // If quotationId provided, load it and pre-fill
  let quote: Record<string, unknown> | null = null;
  if (quotationId) {
    const { data } = await supabase
      .from("supplier_quotations")
      .select(
        "*, suppliers(id, supplier_code, legal_name), projects(id, project_code, name_ar, name_en), rfqs(rfq_number), supplier_quotation_items(*)",
      )
      .eq("id", quotationId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    quote = data;
  }

  if (!quote && quotationId) notFound();

  // One awarded quotation → one active PO: an already-ordered quotation opens its PO.
  if (quotationId) {
    const { data: existingPo } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("quotation_id", quotationId)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (existingPo) redirect(`/procurement/purchase-orders/${existingPo.id}`);
  }

  // If no quotationId, show a selector for awarded quotations that have no active PO yet
  let awardedQuotes: Array<Record<string, unknown>> = [];
  if (!quotationId) {
    const { data } = await supabase
      .from("supplier_quotations")
      .select("id, quotation_number, total, currency, rfq_id, suppliers(legal_name)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(50);
    const accepted = (data as Array<Record<string, unknown>>) ?? [];
    const ids = accepted.map((q) => String(q.id));
    const { data: orderedRows } = ids.length
      ? await supabase
          .from("purchase_orders")
          .select("quotation_id")
          .in("quotation_id", ids)
          .neq("status", "cancelled")
      : { data: [] as Array<{ quotation_id: string | null }> };
    const ordered = new Set((orderedRows ?? []).map((r) => String(r.quotation_id)));
    awardedQuotes = accepted.filter((q) => !ordered.has(String(q.id)));

    if (!awardedQuotes.length) {
      return (
        <PageContainer className="mx-auto max-w-2xl">
          <PageHeader title={tf.title} description={tf.descriptionEmpty} />
          <Card>
            <p className="text-sm text-warning">{tf.noAwarded}</p>
          </Card>
        </PageContainer>
      );
    }
  }

  const supplier = quote ? (Array.isArray(quote.suppliers) ? quote.suppliers[0] : quote.suppliers) : null;
  const project = quote ? (Array.isArray(quote.projects) ? quote.projects[0] : quote.projects) : null;
  const items = quote ? ((quote.supplier_quotation_items as Array<Record<string, unknown>>) ?? []) : [];
  const s = supplier as Record<string, string> | null;
  const prj = project as Record<string, string | null> | null;

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createPoFromQuotationAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/purchase-orders");
  }

  return (
    <PageContainer className="mx-auto max-w-3xl" data-testid="po-create-page">
      <PageHeader title={tf.title} description={tf.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="po-create-form">
          {quote ? (
            <input type="hidden" name="quotationId" value={String(quote.id)} />
          ) : (
            <Field label={tf.awardedQuotation}>
              <Select name="quotationId" required defaultValue="" data-testid="po-quotation">
                <option value="" disabled>{tf.chooseQuotation}</option>
                {awardedQuotes.map((q) => {
                  const qs = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <option key={String(q.id)} value={String(q.id)}>
                      {String(q.quotation_number)} — {(qs as Record<string, string> | null)?.legal_name ?? "—"} —{" "}
                      {Number(q.total).toLocaleString(intlLocale(locale), { minimumFractionDigits: 2 })} {String(q.currency)}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}

          {quote ? (
            <>
              <dl className="grid gap-4 rounded-xl border border-line bg-surface-muted p-4 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">{tc.supplier}</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    <span dir="ltr" className="font-mono text-xs">{s?.supplier_code}</span> — {s?.legal_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{tc.project}</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    <span dir="ltr" className="font-mono text-xs">{prj?.project_code}</span> —{" "}
                    {pickLocalized(locale, prj?.name_ar, prj?.name_en)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{tf.awardedQuotationShort}</dt>
                  <dd className="mt-0.5 font-medium text-ink" dir="ltr">
                    <span className="font-mono text-xs">{String(quote.quotation_number)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{tc.total}</dt>
                  <dd className="mt-0.5 font-bold text-ink">
                    <MoneyDisplay amount={quote.total as number} currency={String(quote.currency)} locale={locale} />
                  </dd>
                </div>
                {(quote.payment_terms as string | null) ? (
                  <div>
                    <dt className="text-xs text-muted">{tc.paymentTerms}</dt>
                    <dd className="mt-0.5 text-ink">{String(quote.payment_terms)}</dd>
                  </div>
                ) : null}
              </dl>

              <TableScroll className="rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start font-semibold">#</th>
                      <th className="px-3 py-2 text-start font-semibold">{tc.description}</th>
                      <th className="px-3 py-2 text-end font-semibold">{tc.quantity}</th>
                      <th className="px-3 py-2 text-end font-semibold">{tc.unitPrice}</th>
                      <th className="px-3 py-2 text-end font-semibold">{tc.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={String(item.id)} className="border-t border-line">
                        <td className="px-3 py-2 text-muted">{String(item.line_no)}</td>
                        <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{String(item.quantity)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          <MoneyDisplay amount={item.unit_price as number} currency={String(quote.currency)} locale={locale} />
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">
                          <MoneyDisplay amount={item.total_price as number} currency={String(quote.currency)} locale={locale} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          ) : null}

          <Field label={tf.requiredDeliveryDate}>
            <Input name="requiredDeliveryDate" type="date" data-testid="po-delivery-date" />
          </Field>
          <Field label={tc.deliveryAddress}>
            <Input name="deliveryAddress" placeholder={tf.deliveryAddressPlaceholder} data-testid="po-delivery-address" />
          </Field>

          <div className="flex justify-end gap-3">
            <Link href="/procurement/purchase-orders">
              <Button type="button" variant="secondary">
                {tc.cancel}
              </Button>
            </Link>
            <Button type="submit" data-testid="po-create-submit">{tf.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
