import { todayInRiyadh } from "@/lib/time/riyadh";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClientInvoiceAction } from "@/server/use-cases/commercial";
import { grossWithVat, valuationTaxableBase, valuationVatRate, type ValuationBillingAmounts } from "@/server/domain/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewClientInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ valuationId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.create")) redirect("/finance/client-invoices");

  const { t, locale } = await getI18n();
  const tf = t.financeClient.invoiceForm;
  const tc = t.financeClient.common;
  const numberLocale = intlLocale(locale);

  const { valuationId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  let prefilledValuation: Record<string, unknown> | null = null;
  if (valuationId) {
    const { data } = await supabase
      .from("client_valuations")
      .select(
        "id, valuation_number, project_id, contract_id, certified_amount, total_claim, current_claim_amount, vat_amount, status, project_contracts(client_name, contract_number), projects(project_code, name_ar)",
      )
      .eq("id", valuationId)
      .maybeSingle();
    prefilledValuation = data;
  }

  const { data: valuations } = await supabase
    .from("client_valuations")
    .select("id, valuation_number, certified_amount, total_claim, current_claim_amount, vat_amount, project_id, contract_id, status")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["certified", "partially_certified"])
    .order("created_at", { ascending: false })
    .limit(50);

  const certifiedValuations = valuations ?? [];
  const selected =
    prefilledValuation ??
    (certifiedValuations.length > 0 ? certifiedValuations[0] : null);

  const { data: activeContracts } = await supabase
    .from("project_contracts")
    .select("id, contract_number, client_name, project_id")
    .eq("organization_id", ctx.organization.id)
    .eq("status", "active");

  // certified_amount / total_claim include VAT — pre-fill the taxable (pre-VAT) base.
  const certifiedGross = selected
    ? Number(
        (selected as Record<string, unknown>).certified_amount ??
          (selected as Record<string, unknown>).total_claim ??
          0,
      )
    : 0;
  const vatRateDefault = selected ? valuationVatRate(selected as ValuationBillingAmounts) : 15;
  const taxableDefault = selected ? valuationTaxableBase(selected as ValuationBillingAmounts) : 0;

  async function action(
    _prev: import("@/server/forms/form-state").FormActionState,
    formData: FormData,
  ): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const contractId = String(formData.get("contractId") ?? "");
    const valuationIdForm = String(formData.get("valuationId") ?? "");
    const supabaseInner = await createServerSupabaseClient();

    if (valuationIdForm) {
      const { data: val } = await supabaseInner
        .from("client_valuations")
        .select("project_id, contract_id")
        .eq("id", valuationIdForm)
        .maybeSingle();
      if (val) {
        formData.set("projectId", val.project_id);
        if (val.contract_id) formData.set("contractId", val.contract_id);
      }
    } else if (contractId) {
      const { data: contract } = await supabaseInner
        .from("project_contracts")
        .select("project_id")
        .eq("id", contractId)
        .maybeSingle();
      if (contract) formData.set("projectId", contract.project_id);
    }

    return createClientInvoiceAction(_prev, formData);
  }

  return (
    <PageContainer className="mx-auto max-w-2xl" data-testid="client-invoice-create-page">
      <PageHeader
        title={tf.title}
        description={valuationId ? tf.descriptionFromValuation : tf.descriptionDefault}
        actions={
          <Link href="/finance/client-invoices" className="text-sm font-medium text-primary hover:underline">
            {tc.register}
          </Link>
        }
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="client-invoice-create-form">
          <Field label={tf.valuation}>
            <Select name="valuationId" defaultValue={selected ? String((selected as Record<string, unknown>).id) : ""} data-testid="invoice-valuation">
              <option value="">{tf.noValuation}</option>
              {certifiedValuations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.valuation_number} —{" "}
                  {v.certified_amount != null
                    ? `${Number(v.certified_amount).toLocaleString(numberLocale)} SAR`
                    : `${Number(v.total_claim).toLocaleString(numberLocale)} SAR`}
                </option>
              ))}
            </Select>
          </Field>

          {!selected ? (
            <>
              <Field label={tf.contract}>
                <Select name="contractId" required data-testid="invoice-contract">
                  <option value="" disabled>
                    {tf.chooseContract}
                  </option>
                  {(activeContracts ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contract_number} — {c.client_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <input type="hidden" name="projectId" value="" />
            </>
          ) : (
            <>
              <input type="hidden" name="projectId" value={String((selected as Record<string, unknown>).project_id)} />
              <input
                type="hidden"
                name="contractId"
                value={String((selected as Record<string, unknown>).contract_id ?? "")}
              />
              <div className="rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
                <p className="text-muted">{tf.certifiedForBilling}</p>
                <p className="mt-1 font-semibold tabular-nums text-ink">
                  <MoneyDisplay amount={certifiedGross} currency="SAR" locale={locale} />
                </p>
              </div>
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tf.invoiceNumber}>
              <Input name="invoiceNumber" required placeholder="INV-2025-001" data-testid="client-invoice-number" />
            </Field>
            <Field label={tf.invoiceDate}>
              <Input
                name="invoiceDate"
                type="date"
                required
                defaultValue={todayInRiyadh()}
                data-testid="client-invoice-date"
              />
            </Field>
            <Field label={tf.dueDate}>
              <Input name="dueDate" type="date" />
            </Field>
            <Field label={tf.taxableAmount}>
              <Input
                name="taxableAmount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={String(taxableDefault)}
                data-testid="client-invoice-taxable"
              />
            </Field>
            <Field label={tf.vatRate}>
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue={String(vatRateDefault)} />
            </Field>
            <Field label={tf.currency}>
              <Select name="currency" defaultValue="SAR">
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          </div>

          <p className="text-sm text-muted">
            {tf.expectedTotal}{" "}
            <span className="tabular-nums text-ink">
              <MoneyDisplay amount={grossWithVat(taxableDefault, vatRateDefault)} currency="SAR" locale={locale} />
            </span>
          </p>

          <div className="flex justify-end gap-3">
            <Link
              href="/finance/client-invoices"
              className="inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted"
            >
              {tc.cancel}
            </Link>
            <Button type="submit" data-testid="client-invoice-submit">
              {tf.submit}
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
