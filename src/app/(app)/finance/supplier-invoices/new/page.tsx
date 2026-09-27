import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupplierInvoiceAction } from "@/server/use-cases/finance";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewSupplierInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "supplier_invoice.create");
  const { poId: preselectedPoId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const [projectsResult, suppliersResult, posResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar")
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
    <div className="mx-auto max-w-2xl" data-testid="invoice-create-page">
      <PageHeader title="فاتورة مورد جديدة" description="ستُنفَّذ المطابقة تلقائياً عند الحفظ" />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="invoice-create-form">
          <Field label="المشروع">
            <Select name="projectId" required defaultValue={prefilledPo ? "" : ""} data-testid="invoice-project">
              <option value="" disabled>اختر مشروعاً</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_code} — {p.name_ar}</option>
              ))}
            </Select>
          </Field>
          <Field label="المورد">
            <Select name="supplierId" required defaultValue={prefilledPo?.supplier_id ?? ""} data-testid="invoice-supplier">
              <option value="" disabled>اختر المورد</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="أمر الشراء المرتبط (اختياري)">
            <Select name="purchaseOrderId" defaultValue={preselectedPoId ?? ""} data-testid="invoice-po">
              <option value="">بدون ربط بأمر شراء</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.po_number} — {Number(p.total).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} {p.currency}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="رقم الفاتورة (المورد)">
              <Input name="invoiceNumber" required placeholder="مثال: INV-2025-0042" data-testid="invoice-number" />
            </Field>
            <Field label="تاريخ الفاتورة">
              <Input name="invoiceDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} data-testid="invoice-date" />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <Input name="dueDate" type="date" />
            </Field>
            <Field label="المبلغ قبل الضريبة (SAR)">
              <Input name="subtotal" type="number" step="0.01" min="0" required defaultValue="0" data-testid="invoice-subtotal" />
            </Field>
            <Field label="نسبة ضريبة القيمة المضافة (%)">
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Link href="/finance/supplier-invoices" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit" data-testid="invoice-submit">حفظ وتنفيذ المطابقة</Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
