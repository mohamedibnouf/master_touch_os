import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, StatCard, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const supplier = await repo.getSupplier(id);
  if (!supplier) notFound();

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const td = t.procurementOrders.supplierDetail;

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
          <Link
            href="/procurement/suppliers"
            className="inline-flex items-center rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {tc.backToRegister}
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label={tc.status} value={<CommercialStatusBadge status={supplier.status} locale={locale} />} />
        <StatCard label={td.city} value={<span className="text-sm font-medium">{supplier.city ?? "—"}</span>} />
        <StatCard
          label={td.contact}
          value={
            <span className="block space-y-0.5 text-xs font-normal" dir="ltr">
              <span className="block">{supplier.email ?? "—"}</span>
              <span className="block">{supplier.phone ?? "—"}</span>
            </span>
          }
        />
        <StatCard
          label={tc.paymentTerms}
          value={<span className="text-base font-semibold">{format(tc.days, { days: supplier.payment_terms_days })}</span>}
        />
      </div>

      {/* Performance */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{td.performance}</h2>
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-xl bg-surface-muted p-3">
            <p className="text-xs text-muted">{td.rfqResponseRate}</p>
            <p className="mt-1 font-semibold tabular-nums text-ink">
              {responseRate != null ? `${responseRate}%` : "—"} ({responded}/{totalInvited})
            </p>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <p className="text-xs text-muted">{td.purchaseOrders}</p>
            <p className="mt-1 font-semibold tabular-nums text-ink">{pos.length}</p>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <p className="text-xs text-muted">{td.rejectedReceipts}</p>
            <p className={`mt-1 font-semibold tabular-nums ${rejectedGrns > 0 ? "text-danger" : "text-ink"}`}>{rejectedGrns}</p>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <p className="text-xs text-muted">{td.discrepancyInvoices}</p>
            <p className={`mt-1 font-semibold tabular-nums ${discrepancyInvoices > 0 ? "text-warning" : "text-ink"}`}>
              {discrepancyInvoices}
            </p>
          </div>
        </div>
      </Card>

      {/* Contacts */}
      {contacts.length > 0 ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.contacts}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {contacts.map((c) => (
              <div key={String(c.id)} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-medium text-ink">{String(c.name)}</p>
                {c.job_title ? <p className="text-muted">{String(c.job_title)}</p> : null}
                {c.email ? <p dir="ltr" className="text-start">{String(c.email)}</p> : null}
                {c.phone ? <p dir="ltr" className="text-start">{String(c.phone)}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Recent POs */}
      {pos.length > 0 ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.recentOrders}</h2>
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-start font-semibold">{tc.number}</th>
                  <th className="py-2 text-start font-semibold">{tc.total}</th>
                  <th className="py-2 text-start font-semibold">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-2">
                      <Link
                        href={`/procurement/purchase-orders/${p.id}`}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        dir="ltr"
                      >
                        {p.po_number}
                      </Link>
                    </td>
                    <td className="py-2 tabular-nums">
                      <MoneyDisplay amount={p.total} currency={p.currency} locale={locale} />
                    </td>
                    <td className="py-2"><CommercialStatusBadge status={p.status} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      {/* Banking — finance only */}
      {hasPermission(ctx, "supplier_payment.record") ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.banking}</h2>
          <p className="text-sm text-muted">{td.bankingProtected}</p>
        </Card>
      ) : null}
    </PageContainer>
  );
}
