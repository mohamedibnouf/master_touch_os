import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAndPostGoodsReceiptAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "goods_receipt.create");
  const { poId: preselectedPoId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  // Issued / partially delivered POs
  const { data: eligiblePos } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier_id, suppliers(legal_name), purchase_order_items(*)")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["issued", "partially_delivered"])
    .order("created_at", { ascending: false });

  const selectedPo = preselectedPoId
    ? (eligiblePos ?? []).find((p) => p.id === preselectedPoId)
    : null;

  const poForForm = selectedPo ?? (eligiblePos ?? [])[0];

  if (!poForForm) {
    return (
      <PageContainer className="mx-auto max-w-2xl">
        <PageHeader title="استلام بضاعة جديد" description="GRN" />
        <Card>
          <p className="text-sm text-warning">
            لا توجد أوامر شراء صادرة أو جزئية بانتظار الاستلام. أصدر أمر الشراء أولاً.
          </p>
        </Card>
      </PageContainer>
    );
  }

  const items = (poForForm.purchase_order_items as Array<Record<string, unknown>>) ?? [];
  const supplier = Array.isArray(poForForm.suppliers) ? poForForm.suppliers[0] : poForForm.suppliers;

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createAndPostGoodsReceiptAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/goods-receipts");
  }

  return (
    <PageContainer className="mx-auto max-w-4xl" data-testid="grn-create-page">
      <PageHeader title="تسجيل استلام بضاعة" description="GRN — يُنشر فور الحفظ" />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="grn-create-form">
          {/* PO selector */}
          {(eligiblePos ?? []).length > 1 ? (
            <Field label="أمر الشراء">
              <Select name="poId" required defaultValue={poForForm.id}>
                {(eligiblePos ?? []).map((p) => {
                  const s = Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.po_number} — {(s as Record<string, string> | null)?.legal_name ?? "—"}
                    </option>
                  );
                })}
              </Select>
            </Field>
          ) : (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <span className="text-muted">أمر الشراء: </span>
              <span className="font-medium">{poForForm.po_number}</span>
              {supplier ? ` — ${(supplier as Record<string, string>).legal_name}` : ""}
              <input type="hidden" name="poId" value={poForForm.id} />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="تاريخ التسليم">
              <Input name="deliveryDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} data-testid="grn-delivery-date" />
            </Field>
            <Field label="رقم مذكرة التسليم">
              <Input name="deliveryNoteNumber" placeholder="اختياري" />
            </Field>
            <Field label="الموقع / المستودع">
              <Input name="location" placeholder="اختياري" />
            </Field>
          </div>

          {/* Line items */}
          <div>
            <h3 className="mb-3 font-semibold text-navy">تفاصيل الاستلام</h3>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="bg-paper text-right text-muted">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">الوصف</th>
                    <th className="px-3 py-2">المأمور</th>
                    <th className="px-3 py-2">استُلم سابقاً</th>
                    <th className="px-3 py-2">المتبقي</th>
                    <th className="px-3 py-2">المستلم الآن</th>
                    <th className="px-3 py-2">المقبول</th>
                    <th className="px-3 py-2">المرفوض</th>
                    <th className="px-3 py-2">سبب الرفض</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const ordered = Number(item.quantity);
                    const prevReceived = Number(item.received_quantity ?? 0);
                    const remaining = Math.max(0, ordered - prevReceived);
                    return (
                      <tr key={String(item.id)} className="border-t border-line">
                        <td className="px-3 py-2">{String(item.line_no)}</td>
                        <td className="px-3 py-2">{String(item.description)}</td>
                        <td className="px-3 py-2 tabular-nums">{ordered}</td>
                        <td className="px-3 py-2 tabular-nums text-muted">{prevReceived}</td>
                        <td className={`px-3 py-2 tabular-nums ${remaining > 0 ? "text-warning font-medium" : "text-muted"}`}>
                          {remaining}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`received_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            max={String(remaining)}
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`accepted_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`rejected_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`reason_${item.id}`}
                            placeholder="سبب الرفض"
                            className="w-32"
                            disabled={remaining <= 0}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Field label="ملاحظات">
            <Textarea name="notes" placeholder="أي ملاحظات إضافية..." />
          </Field>

          <div className="flex justify-end gap-3">
            <Link href="/procurement/goods-receipts" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit" data-testid="grn-submit">حفظ ونشر الاستلام</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
