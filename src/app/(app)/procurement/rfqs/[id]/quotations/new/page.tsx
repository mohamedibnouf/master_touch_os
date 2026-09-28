import { PageContainer } from "@/components/layout/page-container";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createQuotationAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

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
    <PageContainer className="mx-auto max-w-3xl" data-testid="quotation-create-page">
      <PageHeader
        title={`تسجيل عرض سعر — ${rfq.rfq_number}`}
        description={rfq.title}
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="quotation-create-form">
          <input type="hidden" name="rfqId" value={rfq.id} />

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="المورد">
              <Select name="supplierId" required defaultValue="" data-testid="quotation-supplier">
                <option value="" disabled>اختر المورد</option>
                {eligibleSuppliers.map((s) => s && (
                  <option key={s.id} value={s.id}>
                    {s.supplier_code} — {s.legal_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="رقم عرض السعر (المورد)">
              <Input name="quotationNumber" required placeholder="مثال: QT-2025-001" data-testid="quotation-number" />
            </Field>
            <Field label="تاريخ العرض">
              <Input name="quotationDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="صلاحية العرض حتى">
              <Input name="validityDate" type="date" />
            </Field>
            <Field label="مدة التسليم (أيام)">
              <Input name="leadTimeDays" type="number" min="0" placeholder="30" />
            </Field>
            <Field label="شروط الدفع">
              <Input name="paymentTerms" placeholder="مثال: 30 يوم من الاستلام" />
            </Field>
            <Field label="الضمان">
              <Input name="warranty" placeholder="مثال: سنة واحدة" />
            </Field>
            <Field label="الخصم (SAR)">
              <Input name="discount" type="number" step="0.01" min="0" defaultValue="0" />
            </Field>
            <Field label="نسبة ضريبة القيمة المضافة (%)">
              <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
            </Field>
          </div>

          <Field label="ملاحظات تجارية">
            <Textarea name="commercialNotes" placeholder="ملاحظات إضافية..." />
          </Field>

          {/* Line items */}
          <div>
            <h3 className="mb-3 font-semibold text-navy">تفاصيل البنود</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-right text-muted">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">الوصف</th>
                    <th className="px-3 py-2">الكمية</th>
                    <th className="px-3 py-2">سعر الوحدة</th>
                    <th className="px-3 py-2">الماركة</th>
                    <th className="px-3 py-2">الموديل</th>
                    <th className="px-3 py-2">مدة التسليم</th>
                    <th className="px-3 py-2">المطابقة</th>
                    <th className="px-3 py-2">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2">{String(item.line_no)}</td>
                      <td className="px-3 py-2">{String(item.description)}</td>
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
                        <Select name={`compliance_${item.id}`} defaultValue="not_assessed" className="w-32">
                          <option value="compliant">مطابق</option>
                          <option value="partial">جزئي</option>
                          <option value="non_compliant">غير مطابق</option>
                          <option value="not_assessed">لم يُقيَّم</option>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input name={`deviation_${item.id}`} placeholder="انحراف..." className="w-32" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <a
              href={`/procurement/rfqs/${rfqId}`}
              className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
            >
              إلغاء
            </a>
            <Button type="submit" data-testid="quotation-submit">حفظ عرض السعر</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
