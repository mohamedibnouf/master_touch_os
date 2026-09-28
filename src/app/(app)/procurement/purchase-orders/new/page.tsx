import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createPoFromQuotationAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ quotationId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "purchase_order.create");
  const { quotationId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  // If quotationId provided, load it and pre-fill
  let quote: Record<string, unknown> | null = null;
  if (quotationId) {
    const { data } = await supabase
      .from("supplier_quotations")
      .select(
        "*, suppliers(id, supplier_code, legal_name), projects(id, project_code, name_ar), rfqs(rfq_number), supplier_quotation_items(*)",
      )
      .eq("id", quotationId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    quote = data;
  }

  if (!quote && quotationId) notFound();

  // If no quotationId, show a selector for awarded quotations
  let awardedQuotes: Array<Record<string, unknown>> = [];
  if (!quotationId) {
    const { data } = await supabase
      .from("supplier_quotations")
      .select("id, quotation_number, total, currency, rfq_id, suppliers(legal_name)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(50);
    awardedQuotes = (data as Array<Record<string, unknown>>) ?? [];

    if (!awardedQuotes.length) {
      return (
        <PageContainer className="mx-auto max-w-2xl">
          <PageHeader title="أمر شراء جديد" description="إنشاء من عرض سعر مرسَّى" />
          <Card>
            <p className="text-sm text-warning">لا توجد عروض أسعار معتمدة للترسية. أكمل دورة المقارنة والاعتماد أولاً.</p>
          </Card>
        </PageContainer>
      );
    }
  }

  const supplier = quote ? (Array.isArray(quote.suppliers) ? quote.suppliers[0] : quote.suppliers) : null;
  const project = quote ? (Array.isArray(quote.projects) ? quote.projects[0] : quote.projects) : null;
  const items = quote ? ((quote.supplier_quotation_items as Array<Record<string, unknown>>) ?? []) : [];

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createPoFromQuotationAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/purchase-orders");
  }

  return (
    <PageContainer className="mx-auto max-w-3xl" data-testid="po-create-page">
      <PageHeader title="أمر شراء جديد" description="ترث البيانات تلقائياً من العرض المرسَّى" />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="po-create-form">
          {quote ? (
            <input type="hidden" name="quotationId" value={String(quote.id)} />
          ) : (
            <Field label="عرض السعر المرسَّى">
              <Select name="quotationId" required defaultValue="" data-testid="po-quotation">
                <option value="" disabled>اختر العرض</option>
                {awardedQuotes.map((q) => {
                  const s = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <option key={String(q.id)} value={String(q.id)}>
                      {String(q.quotation_number)} — {(s as Record<string, string> | null)?.legal_name ?? "—"} —{" "}
                      {Number(q.total).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} {String(q.currency)}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}

          {quote ? (
            <>
              <div className="grid gap-4 rounded-md border border-line bg-paper p-4 text-sm md:grid-cols-2">
                <div>
                  <p className="text-muted text-xs">المورد</p>
                  <p className="font-medium">
                    {(supplier as Record<string, string> | null)?.supplier_code} —{" "}
                    {(supplier as Record<string, string> | null)?.legal_name}
                  </p>
                </div>
                <div>
                  <p className="text-muted text-xs">المشروع</p>
                  <p className="font-medium">
                    {(project as Record<string, string> | null)?.project_code} —{" "}
                    {(project as Record<string, string> | null)?.name_ar}
                  </p>
                </div>
                <div>
                  <p className="text-muted text-xs">العرض المرسَّى</p>
                  <p className="font-medium">{String(quote.quotation_number)}</p>
                </div>
                <div>
                  <p className="text-muted text-xs">الإجمالي</p>
                  <p className="font-bold text-navy">
                    <MoneyDisplay amount={quote.total as number} currency={String(quote.currency)} />
                  </p>
                </div>
                {(quote.payment_terms as string | null) ? (
                  <div>
                    <p className="text-muted text-xs">شروط الدفع</p>
                    <p>{String(quote.payment_terms)}</p>
                  </div>
                ) : null}
              </div>

              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-paper text-right text-muted">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">الوصف</th>
                      <th className="px-3 py-2">الكمية</th>
                      <th className="px-3 py-2">سعر الوحدة</th>
                      <th className="px-3 py-2">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={String(item.id)} className="border-t border-line">
                        <td className="px-3 py-2">{String(item.line_no)}</td>
                        <td className="px-3 py-2">{String(item.description)}</td>
                        <td className="px-3 py-2">{String(item.quantity)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          <MoneyDisplay amount={item.unit_price as number} currency={String(quote.currency)} />
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          <MoneyDisplay amount={item.total_price as number} currency={String(quote.currency)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <Field label="موعد التسليم المطلوب">
            <Input name="requiredDeliveryDate" type="date" data-testid="po-delivery-date" />
          </Field>
          <Field label="عنوان التسليم">
            <Input name="deliveryAddress" placeholder="موقع التسليم" data-testid="po-delivery-address" />
          </Field>

          <div className="flex justify-end gap-3">
            <Link href="/procurement/purchase-orders" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit" data-testid="po-create-submit">إنشاء أمر الشراء</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
