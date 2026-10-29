import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createQuotationAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const thClass = "px-3 py-2 text-start font-medium";

export default async function NewQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = authorize(await getAuthContext(), "quotation.create");
  const { id: rfqId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("id, rfq_number, title, status, rfq_items(*), rfq_suppliers(supplier_id, suppliers(id, supplier_code, legal_name))")
    .eq("id", rfqId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();

  if (!rfq) notFound();
  if (!["issued", "responses_received", "under_comparison"].includes(rfq.status)) {
    redirect(`/procurement/rfqs/${rfqId}`);
  }

  const { t } = await getI18n();
  const tc = t.procurementSourcing.quotations.create;
  const common = t.procurementSourcing.common;

  const items = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const invitations = (rfq.rfq_suppliers as Array<Record<string, unknown>>) ?? [];
  const eligibleSuppliers = invitations
    .map((inv) => {
      const s = Array.isArray(inv.suppliers) ? inv.suppliers[0] : inv.suppliers;
      return s as { id: string; supplier_code: string; legal_name: string } | null;
    })
    .filter(Boolean);

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createQuotationAction(_prev, formData);
    if (!state?.ok) return state;
    redirect(`/procurement/rfqs/${rfqId}`);
  }

  return (
    <PageContainer className="mx-auto max-w-4xl" data-testid="quotation-create-page">
      <PageHeader title={format(tc.title, { number: rfq.rfq_number })} description={rfq.title} />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="quotation-create-form">
          <input type="hidden" name="rfqId" value={rfq.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tc.supplier} required>
              <Select name="supplierId" required defaultValue="" data-testid="quotation-supplier">
                <option value="" disabled>{common.selectSupplier}</option>
                {eligibleSuppliers.map((s) => s && (
                  <option key={s.id} value={s.id}>
                    {format(common.codeName, { code: s.supplier_code, name: s.legal_name })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tc.quotationNumber} required>
              <Input name="quotationNumber" required placeholder={tc.quotationNumberPlaceholder} data-testid="quotation-number" />
            </Field>
            <Field label={tc.quotationDate} required>
              <Input name="quotationDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label={tc.validityDate}>
              <Input name="validityDate" type="date" />
            </Field>
            <Field label={tc.leadTimeDays}>
              <Input name="leadTimeDays" type="number" min="0" placeholder="30" />
            </Field>
            <Field label={tc.paymentTerms}>
              <Input name="paymentTerms" placeholder={tc.paymentTermsPlaceholder} />
            </Field>
            <Field label={tc.warranty}>
              <Input name="warranty" placeholder={tc.warrantyPlaceholder} />
            </Field>
            <Field label={tc.discount}>
              <Input name="discount" type="number" step="0.01" min="0" defaultValue="0" />
            </Field>
            <Field label={tc.vatRate}>
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
            </Field>
          </div>

          <Field label={tc.commercialNotes}>
            <Textarea name="commercialNotes" placeholder={tc.commercialNotesPlaceholder} />
          </Field>

          {/* Line items */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">{tc.itemsTitle}</h3>
            <TableScroll className="rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-xs text-muted">
                  <tr>
                    <th className={thClass}>{tc.columns.line}</th>
                    <th className={thClass}>{tc.columns.description}</th>
                    <th className={thClass}>{tc.columns.quantity}</th>
                    <th className={thClass}>{tc.columns.unitPrice}</th>
                    <th className={thClass}>{tc.columns.brand}</th>
                    <th className={thClass}>{tc.columns.model}</th>
                    <th className={thClass}>{tc.columns.leadTime}</th>
                    <th className={thClass}>{tc.columns.compliance}</th>
                    <th className={thClass}>{tc.columns.notes}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2 tabular-nums text-muted">{String(item.line_no)}</td>
                      <td className="min-w-40 px-3 py-2 text-ink">{String(item.description)}</td>
                      <td className="px-3 py-2">
                        <Input
                          name={`qty_${item.id}`}
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          defaultValue={String(item.quantity)}
                          className="w-24"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          name={`price_${item.id}`}
                          type="number"
                          step="0.0001"
                          min="0"
                          defaultValue="0"
                          className="w-28"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input name={`brand_${item.id}`} className="w-24" />
                      </td>
                      <td className="px-3 py-2">
                        <Input name={`model_${item.id}`} className="w-24" />
                      </td>
                      <td className="px-3 py-2">
                        <Input name={`lead_${item.id}`} type="number" min="0" className="w-20" />
                      </td>
                      <td className="px-3 py-2">
                        <Select name={`compliance_${item.id}`} defaultValue="not_assessed" className="w-36">
                          <option value="compliant">{tc.compliance.compliant}</option>
                          <option value="partial">{tc.compliance.partial}</option>
                          <option value="non_compliant">{tc.compliance.non_compliant}</option>
                          <option value="not_assessed">{tc.compliance.not_assessed}</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input name={`deviation_${item.id}`} placeholder={tc.deviationPlaceholder} className="w-32" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link
              href={`/procurement/rfqs/${rfqId}`}
              className="inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              {common.cancel}
            </Link>
            <Button type="submit" data-testid="quotation-submit">{tc.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
