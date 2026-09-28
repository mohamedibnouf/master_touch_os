import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const supplier = await repo.getSupplier(id);
  if (!supplier) notFound();

  const contacts = (supplier.supplier_contacts as Array<Record<string, unknown>>) ?? [];

  // Performance evidence from live data
  const [rfqsResult, posResult, invoicesResult, grnResult] = await Promise.all([
    supabase
      .from("rfq_suppliers")
      .select("id, response_status, rfq_id")
      .eq("supplier_id", id),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, total, currency")
      .eq("organization_id", ctx.organization.id)
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("supplier_invoices")
      .select("id, invoice_number, status, total, currency, due_date")
      .eq("organization_id", ctx.organization.id)
      .eq("supplier_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("goods_receipts")
      .select("id, receipt_number, status")
      .eq("organization_id", ctx.organization.id)
      .eq("supplier_id", id)
      .limit(50),
  ]);

  const rfqs = rfqsResult.data ?? [];
  const pos = posResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const grns = grnResult.data ?? [];

  const totalInvited = rfqs.length;
  const responded = rfqs.filter((r) => r.response_status === "responded").length;
  const responseRate = totalInvited > 0 ? Math.round((responded / totalInvited) * 100) : null;
  const rejectedGrns = grns.filter((g) => g.status === "rejected").length;
  const discrepancyInvoices = invoices.filter((i) => i.status === "discrepancy").length;

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={supplier.legal_name}
        description={supplier.supplier_code}
        actions={
          <Link href="/procurement/suppliers" className="text-sm underline">
            السجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={supplier.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المدينة</p>
          <p className="mt-2 text-sm">{supplier.city ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">البريد / الهاتف</p>
          <p className="mt-2 text-xs">{supplier.email ?? "—"}</p>
          <p className="text-xs">{supplier.phone ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">شروط الدفع</p>
          <p className="mt-2 font-semibold">{supplier.payment_terms_days} يوم</p>
        </Card>
      </div>

      {/* Performance */}
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">أداء المورد (من بيانات فعلية)</h2>
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-muted">نسبة الاستجابة للـ RFQ</p>
            <p className="font-semibold">{responseRate != null ? `${responseRate}%` : "—"} ({responded}/{totalInvited})</p>
          </div>
          <div>
            <p className="text-muted">أوامر الشراء</p>
            <p className="font-semibold">{pos.length}</p>
          </div>
          <div>
            <p className="text-muted">مستندات استلام مرفوضة</p>
            <p className={`font-semibold ${rejectedGrns > 0 ? "text-danger" : ""}`}>{rejectedGrns}</p>
          </div>
          <div>
            <p className="text-muted">فواتير باختلاف</p>
            <p className={`font-semibold ${discrepancyInvoices > 0 ? "text-warning" : ""}`}>{discrepancyInvoices}</p>
          </div>
        </div>
      </Card>

      {/* Contacts */}
      {contacts.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">جهات الاتصال</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {contacts.map((c) => (
              <div key={String(c.id)} className="rounded-md border border-line p-3 text-sm">
                <p className="font-medium">{String(c.name)}</p>
                {c.job_title ? <p className="text-muted">{String(c.job_title)}</p> : null}
                {c.email ? <p>{String(c.email)}</p> : null}
                {c.phone ? <p>{String(c.phone)}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Recent POs */}
      {pos.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">أوامر الشراء الأخيرة</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">الرقم</th>
                  <th className="py-2 text-right">الإجمالي</th>
                  <th className="py-2 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/procurement/purchase-orders/${p.id}`} className="font-medium text-navy underline">
                        {p.po_number}
                      </Link>
                    </td>
                    <td className="py-2 tabular-nums">
                      <MoneyDisplay amount={p.total} currency={p.currency} />
                    </td>
                    <td className="py-2"><CommercialStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Banking — finance only */}
      {hasPermission(ctx, "supplier_payment.record") ? (
        <Card>
          <h2 className="mb-3 font-semibold text-navy">معلومات بنكية</h2>
          <p className="text-sm text-muted">
            معلومات الحساب البنكي محمية — استخدم RPC get_supplier_banking للاطلاع.
          </p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
