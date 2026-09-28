import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "quotation.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: quote } = await supabase
    .from("supplier_quotations")
    .select(
      "*, suppliers(id, supplier_code, legal_name), projects(id, project_code, name_ar), rfqs(id, rfq_number, title), supplier_quotation_items(*)",
    )
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();

  if (!quote) notFound();

  const supplier = Array.isArray(quote.suppliers) ? quote.suppliers[0] : quote.suppliers;
  const project = Array.isArray(quote.projects) ? quote.projects[0] : quote.projects;
  const rfq = Array.isArray(quote.rfqs) ? quote.rfqs[0] : quote.rfqs;
  const items = (quote.supplier_quotation_items as Array<Record<string, unknown>>) ?? [];

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={quote.quotation_number}
        description={`عرض سعر — ${(supplier as Record<string, string> | null)?.legal_name ?? "—"}`}
        actions={
          rfq ? (
            <Link href={`/procurement/rfqs/${(rfq as Record<string, string>).id}`} className="text-sm underline">
              العودة لـ {(rfq as Record<string, string>).rfq_number}
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={quote.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المورد</p>
          <p className="mt-2 text-sm font-medium">
            {(supplier as Record<string, string> | null)?.legal_name ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المشروع</p>
          <p className="mt-2 text-sm font-medium">
            {project ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}` : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">تاريخ العرض</p>
          <p className="mt-2 font-semibold">{quote.quotation_date}</p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy">شروط تجارية</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">صلاحية العرض</dt>
              <dd>{quote.validity_date ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">شروط الدفع</dt>
              <dd>{quote.payment_terms ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">الضمان</dt>
              <dd>{quote.warranty ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">مدة التسليم</dt>
              <dd>{quote.delivery_lead_time_days != null ? `${quote.delivery_lead_time_days} يوم` : "—"}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-navy">إجماليات</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">الإجمالي قبل الخصم</dt>
              <dd><MoneyDisplay amount={quote.subtotal} currency={quote.currency} /></dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">الخصم</dt>
              <dd><MoneyDisplay amount={quote.discount} currency={quote.currency} /></dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">ضريبة القيمة المضافة ({quote.vat_rate_percent}%)</dt>
              <dd><MoneyDisplay amount={quote.vat_amount} currency={quote.currency} /></dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>الإجمالي الكلي</dt>
              <dd><MoneyDisplay amount={quote.total} currency={quote.currency} /></dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">بنود العرض</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">لا توجد بنود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper text-right text-muted">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">الوصف</th>
                  <th className="px-3 py-2">الكمية</th>
                  <th className="px-3 py-2">سعر الوحدة</th>
                  <th className="px-3 py-2">الإجمالي</th>
                  <th className="px-3 py-2">الماركة</th>
                  <th className="px-3 py-2">الموديل</th>
                  <th className="px-3 py-2">مدة التسليم</th>
                  <th className="px-3 py-2">المطابقة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="px-3 py-2">{String(item.line_no)}</td>
                    <td className="px-3 py-2">{String(item.description)}</td>
                    <td className="px-3 py-2 tabular-nums">{String(item.quantity)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <MoneyDisplay amount={item.unit_price as number} currency={quote.currency} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <MoneyDisplay amount={item.total_price as number} currency={quote.currency} />
                    </td>
                    <td className="px-3 py-2">{String(item.offered_brand ?? "—")}</td>
                    <td className="px-3 py-2">{String(item.offered_model ?? "—")}</td>
                    <td className="px-3 py-2">
                      {item.lead_time_days != null ? `${String(item.lead_time_days)} يوم` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <CommercialStatusBadge status={String(item.compliance_status ?? "not_assessed")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {quote.commercial_notes ? (
        <Card>
          <h2 className="mb-2 font-semibold text-navy">ملاحظات</h2>
          <p className="text-sm">{quote.commercial_notes}</p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
