import { PageContainer } from "@/components/layout/page-container";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { MoneyDisplay } from "@/components/commercial/money";

export default async function PurchaseOrderPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_order.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const po = await repo.getPurchaseOrder(id);
  if (!po) notFound();

  const supplier = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
  const project = Array.isArray(po.projects) ? po.projects[0] : po.projects;
  const items = (po.purchase_order_items as Array<Record<string, unknown>>) ?? [];

  const s = supplier as Record<string, string> | null;
  const prj = project as Record<string, string> | null;

  return (
    <PageContainer className="mx-auto max-w-3xl print:mx-0 print:max-w-none">
      {/* Print button */}
      <div className="mb-6 print:hidden">
        <button
          onClick={undefined}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
          suppressHydrationWarning
        >
          طباعة
        </button>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `document.querySelector('button').onclick = function(){ window.print(); }`,
          }}
        />
      </div>

      {/* PO Document */}
      <div className="rounded-lg border border-line bg-white p-8 print:rounded-none print:border-0 print:p-0">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between border-b-2 border-primary pb-6">
          <div>
            <h1 className="text-2xl font-bold text-navy">MASTER TOUCH</h1>
            <p className="text-sm text-muted">General Contracting & Smart Systems</p>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold text-navy">أمر شراء — Purchase Order</h2>
            <p className="mt-1 text-lg font-semibold">{po.po_number}</p>
            {po.issue_date ? (
              <p className="text-sm text-muted">
                تاريخ الإصدار: {po.issue_date}
              </p>
            ) : null}
          </div>
        </div>

        {/* Parties */}
        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold text-navy">معلومات المورد</h3>
            <p className="font-medium">{s?.legal_name ?? "—"}</p>
            {s?.trade_name ? <p className="text-sm text-muted">{s.trade_name}</p> : null}
            {(s as Record<string, string> | null)?.email ? (
              <p className="text-sm">{(s as Record<string, string>).email}</p>
            ) : null}
            {(s as Record<string, string> | null)?.phone ? (
              <p className="text-sm">{(s as Record<string, string>).phone}</p>
            ) : null}
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-navy">تفاصيل الطلب</h3>
            <p className="text-sm">
              <span className="text-muted">المشروع: </span>
              {prj ? `${prj.project_code} — ${prj.name_ar}` : "—"}
            </p>
            {po.required_delivery_date ? (
              <p className="text-sm">
                <span className="text-muted">موعد التسليم: </span>
                {po.required_delivery_date}
              </p>
            ) : null}
            {po.payment_terms ? (
              <p className="text-sm">
                <span className="text-muted">شروط الدفع: </span>
                {po.payment_terms}
              </p>
            ) : null}
            {po.delivery_terms ? (
              <p className="text-sm">
                <span className="text-muted">شروط التسليم: </span>
                {po.delivery_terms}
              </p>
            ) : null}
            {po.delivery_address ? (
              <p className="text-sm">
                <span className="text-muted">عنوان التسليم: </span>
                {po.delivery_address}
              </p>
            ) : null}
          </div>
        </div>

        {/* Line items */}
        <table className="mb-6 w-full text-sm">
          <thead>
            <tr className="bg-primary text-white">
              <th className="px-3 py-2 text-right">#</th>
              <th className="px-3 py-2 text-right">الوصف</th>
              <th className="px-3 py-2 text-right">الكمية</th>
              <th className="px-3 py-2 text-right">الوحدة</th>
              <th className="px-3 py-2 text-right">سعر الوحدة</th>
              <th className="px-3 py-2 text-right">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={String(item.id)} className="border-b border-line">
                <td className="px-3 py-2">{String(item.line_no)}</td>
                <td className="px-3 py-2">{String(item.description)}</td>
                <td className="px-3 py-2 tabular-nums">{String(item.quantity)}</td>
                <td className="px-3 py-2">{String(item.unit ?? "—")}</td>
                <td className="px-3 py-2 tabular-nums">
                  <MoneyDisplay amount={item.unit_price as number} currency={po.currency} />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <MoneyDisplay amount={item.line_total as number} currency={po.currency} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={5} className="px-3 py-2 text-left font-medium text-muted">الإجمالي قبل الخصم</td>
              <td className="px-3 py-2 tabular-nums font-medium">
                <MoneyDisplay amount={po.subtotal} currency={po.currency} />
              </td>
            </tr>
            {Number(po.discount) > 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-left text-muted">الخصم</td>
                <td className="px-3 py-2 tabular-nums text-danger">
                  - <MoneyDisplay amount={po.discount} currency={po.currency} />
                </td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={5} className="px-3 py-2 text-left text-muted">
                ضريبة القيمة المضافة ({po.vat_rate_percent}%)
              </td>
              <td className="px-3 py-2 tabular-nums">
                <MoneyDisplay amount={po.vat_amount} currency={po.currency} />
              </td>
            </tr>
            <tr className="bg-paper font-bold">
              <td colSpan={5} className="px-3 py-3 text-left text-navy">الإجمالي الكلي</td>
              <td className="px-3 py-3 tabular-nums text-navy">
                <MoneyDisplay amount={po.total} currency={po.currency} />
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div className="mt-8 border-t border-line pt-6 text-xs text-muted">
          <p>أمر الشراء هذا صادر رسمياً عن شركة ماستر تاتش — MASTER TOUCH General Contracting.</p>
          <p className="mt-1">أُصدر في: {po.issued_at ? new Date(po.issued_at).toLocaleString("ar-SA") : "—"}</p>
        </div>
      </div>
    </PageContainer>
  );
}
