import { todayInRiyadh } from "@/lib/time/riyadh";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupplierInvoiceAction } from "@/server/use-cases/finance";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewSupplierInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "supplier_invoice.create");
  const { poId: preselectedPoId } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { t, locale } = await getI18n();
  const tf = t.financePayables.supplierInvoiceForm;
  const common = t.financePayables.common;

  const [projectsResult, suppliersResult, posResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar, name_en")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("suppliers")
      .select("id, supplier_code, legal_name")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("legal_name"),
    supabase
      .from("purchase_orders")
      .select("id, po_number, supplier_id, total, currency")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["issued", "partially_delivered", "delivered", "partially_invoiced"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const projects = projectsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];
  const pos = posResult.data ?? [];

  // Pre-fill from PO if provided
  let prefilledPo = null;
  if (preselectedPoId) {
    prefilledPo = pos.find((p) => p.id === preselectedPoId) ?? null;
  }

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createSupplierInvoiceAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/finance/supplier-invoices");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl" data-testid="invoice-create-page">
      <PageHeader title={tf.title} description={tf.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="invoice-create-form">
          <Field label={tf.project} required>
            <Select name="projectId" required defaultValue={prefilledPo ? "" : ""} data-testid="invoice-project">
              <option value="" disabled>{tf.chooseProject}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {format(common.projectOption, {
                    code: p.project_code,
                    name: pickLocalized(locale, p.name_ar, p.name_en),
                  })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tf.supplier} required>
            <Select name="supplierId" required defaultValue={prefilledPo?.supplier_id ?? ""} data-testid="invoice-supplier">
              <option value="" disabled>{tf.chooseSupplier}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {format(tf.supplierOption, { code: s.supplier_code, name: s.legal_name })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tf.purchaseOrder}>
            <Select name="purchaseOrderId" defaultValue={preselectedPoId ?? ""} data-testid="invoice-po">
              <option value="">{tf.noPurchaseOrder}</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.po_number} — {Number(p.total).toLocaleString(intlLocale(locale), { minimumFractionDigits: 2 })} {p.currency}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tf.invoiceNumber} required>
              <Input name="invoiceNumber" required placeholder={tf.invoiceNumberPlaceholder} data-testid="invoice-number" />
            </Field>
            <Field label={tf.invoiceDate} required>
              <Input name="invoiceDate" type="date" required defaultValue={todayInRiyadh()} data-testid="invoice-date" />
            </Field>
            <Field label={tf.dueDate}>
              <Input name="dueDate" type="date" />
            </Field>
            <Field label={tf.subtotal} required>
              <Input name="subtotal" type="number" step="0.01" min="0" required defaultValue="0" className="tabular-nums" data-testid="invoice-subtotal" />
            </Field>
            <Field label={tf.vatRate}>
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" className="tabular-nums" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link
              href="/finance/supplier-invoices"
              className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted md:min-h-9"
            >
              {common.cancel}
            </Link>
            <Button type="submit" data-testid="invoice-submit">{tf.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
