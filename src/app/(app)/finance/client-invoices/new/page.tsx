import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClientInvoiceAction } from "@/server/use-cases/commercial";
import { grossWithVat } from "@/server/domain/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewClientInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ valuationId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.create")) redirect("/finance/client-invoices");

  const { valuationId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  let prefilledValuation: Record<string, unknown> | null = null;
  if (valuationId) {
    const { data } = await supabase
      .from("client_valuations")
      .select(
        "id, valuation_number, project_id, contract_id, certified_amount, total_claim, status, project_contracts(client_name, contract_number), projects(project_code, name_ar)",
      )
      .eq("id", valuationId)
      .maybeSingle();
    prefilledValuation = data;
  }

  const { data: valuations } = await supabase
    .from("client_valuations")
    .select("id, valuation_number, certified_amount, total_claim, project_id, contract_id, status")
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

  const taxableDefault = selected
    ? Number(
        (selected as Record<string, unknown>).certified_amount ??
          (selected as Record<string, unknown>).total_claim ??
          0,
      )
    : 0;

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
    <div className="mx-auto max-w-2xl" data-testid="client-invoice-create-page">
      <PageHeader
        title="فاتورة عميل جديدة"
        description={valuationId ? "من مستخلص معتمد" : "يُفضّل الربط بمستخلص معتمد من العميل"}
        actions={
          <Link href="/finance/client-invoices" className="text-sm underline">
            السجل
          </Link>
        }
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="client-invoice-create-form">
          <Field label="المستخلص (مُفضّل)">
            <Select name="valuationId" defaultValue={selected ? String((selected as Record<string, unknown>).id) : ""} data-testid="invoice-valuation">
              <option value="">بدون مستخلص</option>
              {certifiedValuations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.valuation_number} —{" "}
                  {v.certified_amount != null
                    ? `${Number(v.certified_amount).toLocaleString("ar-SA")} SAR`
                    : `${Number(v.total_claim).toLocaleString("ar-SA")} SAR`}
                </option>
              ))}
            </Select>
          </Field>

          {!selected ? (
            <>
              <Field label="العقد">
                <Select name="contractId" required data-testid="invoice-contract">
                  <option value="" disabled>
                    اختر عقداً
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
              <div className="rounded-md bg-paper px-4 py-3 text-sm">
                <p className="text-muted">المبلغ المعتمد للفوترة:</p>
                <p className="mt-1 font-semibold text-navy">
                  <MoneyDisplay amount={taxableDefault} currency="SAR" />
                </p>
              </div>
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="رقم الفاتورة">
              <Input name="invoiceNumber" required placeholder="INV-2025-001" data-testid="client-invoice-number" />
            </Field>
            <Field label="تاريخ الفاتورة">
              <Input
                name="invoiceDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                data-testid="client-invoice-date"
              />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <Input name="dueDate" type="date" />
            </Field>
            <Field label="المبلغ الخاضع للضريبة (SAR)">
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
            <Field label="نسبة ضريبة القيمة المضافة (%)">
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
            </Field>
            <Field label="العملة">
              <Select name="currency" defaultValue="SAR">
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          </div>

          <p className="text-sm text-muted">
            الإجمالي المتوقع (شامل الضريبة):{" "}
            <MoneyDisplay amount={grossWithVat(taxableDefault, 15)} currency="SAR" />
          </p>

          <div className="flex justify-end gap-3">
            <Link
              href="/finance/client-invoices"
              className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium"
            >
              إلغاء
            </Link>
            <Button type="submit" data-testid="client-invoice-submit">
              حفظ الفاتورة
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
