import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, PackagePlus, Printer, X } from "lucide-react";
import { Button, Card, PageHeader, StatCard, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import {
  submitPurchaseOrderForApprovalAction,
  issuePurchaseOrderAction,
} from "@/server/use-cases/procurement";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const navLinkClass =
  "inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

export default async function PurchaseOrderDetailPage({
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

  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const td = t.procurementOrders.orderDetail;

  const [approval, audit, users] = await Promise.all([
    repo.getApprovalForEntity("purchase_order", id),
    repo.getAuditForEntity("purchase_order", id),
    supabase
      .from("organization_members")
      .select("profile_id, profiles(full_name_ar, full_name_en)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(200),
  ]);

  const supplier = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
  const supplierName = (supplier as Record<string, string> | null)?.legal_name ?? "—";
  const items = (po.purchase_order_items as Array<Record<string, unknown>>) ?? [];

  const canSubmitApproval = po.status === "draft" && hasPermission(ctx, "purchase_order.create");
  const canApprove =
    po.status === "pending_approval" &&
    hasPermission(ctx, "purchase_order.approve") &&
    approval != null;
  const canIssue = po.status === "approved" && hasPermission(ctx, "purchase_order.issue");
  const isIssued = ["issued", "partially_delivered", "delivered", "partially_invoiced", "invoiced", "closed"].includes(po.status);

  const pendingStep = approval?.approval_steps?.find(
    (s: Record<string, unknown>) =>
      ["pending", "in_progress"].includes(String(s.status)) && String(s.user_id ?? "") === ctx.userId,
  ) as Record<string, unknown> | undefined;

  // Goods receipts for this PO
  const { data: receipts } = await supabase
    .from("goods_receipts")
    .select("id, receipt_number, delivery_date, status")
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: false });

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={po.po_number}
        description={format(td.subtitle, { supplier: supplierName })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/procurement/purchase-orders" className={navLinkClass}>
              {tc.backToRegister}
            </Link>
            {isIssued ? (
              <Link
                href={`/procurement/purchase-orders/${id}/print`}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary-soft"
                target="_blank"
              >
                <Printer className="size-4" aria-hidden />
                {td.print}
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label={tc.status} value={<CommercialStatusBadge status={po.status} locale={locale} />} />
        <StatCard label={tc.supplier} value={<span className="text-sm font-medium">{supplierName}</span>} />
        <StatCard
          label={tc.total}
          value={
            <span className="text-lg">
              <MoneyDisplay amount={po.total} currency={po.currency} locale={locale} />
            </span>
          }
          tone="info"
        />
        <StatCard
          label={tc.requiredDelivery}
          value={<span className="text-base font-semibold">{po.required_delivery_date ?? "—"}</span>}
        />
      </div>

      {/* Financials */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{td.financials}</h2>
        <dl className="grid gap-2 text-sm md:w-1/2">
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">{tc.subtotal}</dt>
            <dd><MoneyDisplay amount={po.subtotal} currency={po.currency} locale={locale} /></dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">{tc.discount}</dt>
            <dd><MoneyDisplay amount={po.discount} currency={po.currency} locale={locale} /></dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">{format(tc.vatWithRate, { rate: po.vat_rate_percent })}</dt>
            <dd><MoneyDisplay amount={po.vat_amount} currency={po.currency} locale={locale} /></dd>
          </div>
          <div className="flex justify-between font-bold text-ink">
            <dt>{tc.grandTotal}</dt>
            <dd><MoneyDisplay amount={po.total} currency={po.currency} locale={locale} /></dd>
          </div>
          {po.payment_terms ? (
            <div className="flex justify-between gap-4 border-t border-line pt-1">
              <dt className="text-muted">{tc.paymentTerms}</dt>
              <dd className="text-end">{po.payment_terms}</dd>
            </div>
          ) : null}
          {po.delivery_terms ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{tc.deliveryTerms}</dt>
              <dd className="text-end">{po.delivery_terms}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {/* Items */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">{td.items}</h2>
          {isIssued ? (
            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">
              {td.locked}
            </span>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{tc.noItems}</p>
        ) : (
          <TableScroll className="rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">#</th>
                  <th className="px-3 py-2 text-start font-semibold">{tc.description}</th>
                  <th className="px-3 py-2 text-end font-semibold">{td.orderedQty}</th>
                  <th className="px-3 py-2 text-end font-semibold">{td.receivedQty}</th>
                  <th className="px-3 py-2 text-end font-semibold">{td.remainingQty}</th>
                  <th className="px-3 py-2 text-end font-semibold">{tc.unitPrice}</th>
                  <th className="px-3 py-2 text-end font-semibold">{tc.total}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = Number(item.quantity);
                  const received = Number(item.received_quantity ?? 0);
                  const remaining = Math.max(0, ordered - received);
                  return (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2 text-muted">{String(item.line_no)}</td>
                      <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{ordered}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-success">{received}</td>
                      <td className={`px-3 py-2 text-end tabular-nums ${remaining > 0 ? "text-warning" : "text-success"}`}>
                        {remaining}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        <MoneyDisplay amount={item.unit_price as number} currency={po.currency} locale={locale} />
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        <MoneyDisplay amount={item.line_total as number} currency={po.currency} locale={locale} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {/* Submit for approval */}
      {canSubmitApproval ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.submitForApproval}</h2>
          <ServerActionForm action={submitPurchaseOrderForApprovalAction} className="flex flex-wrap gap-3">
            <input type="hidden" name="poId" value={po.id} />
            <select
              name="approverProfileId"
              required
              className="h-10 min-w-[14rem] rounded-md border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">{td.chooseApprover}</option>
              {(users.data ?? []).map((u) => {
                const p = (Array.isArray(u.profiles) ? u.profiles[0] : u.profiles) as Record<string, string | null> | null;
                return (
                  <option key={u.profile_id} value={u.profile_id}>
                    {pickLocalized(locale, p?.full_name_ar, p?.full_name_en) || u.profile_id}
                  </option>
                );
              })}
            </select>
            <Button type="submit">{td.submitForApproval}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Approve / Reject */}
      {canApprove && pendingStep ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.approvalDecision}</h2>
          <div className="flex gap-3">
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="A" />
              <Button type="submit" variant="success">
                <Check className="size-4" aria-hidden />
                {td.approve}
              </Button>
            </ServerActionForm>
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="D" />
              <Button type="submit" variant="danger">
                <X className="size-4" aria-hidden />
                {td.reject}
              </Button>
            </ServerActionForm>
          </div>
        </Card>
      ) : null}

      {/* Issue PO */}
      {canIssue ? (
        <Card data-testid="po-issue-card">
          <h2 className="mb-3 font-semibold text-ink">{td.issueTitle}</h2>
          <p className="mb-3 text-sm text-muted">{td.issueHint}</p>
          <ServerActionForm action={issuePurchaseOrderAction} data-testid="po-issue-form">
            <input type="hidden" name="poId" value={po.id} />
            <Button type="submit" data-testid="po-issue-submit">{td.issue}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* GRN action */}
      {isIssued && hasPermission(ctx, "goods_receipt.create") ? (
        <div>
          <Link href={`/procurement/goods-receipts/new?poId=${id}`}>
            <Button type="button">
              <PackagePlus className="size-4" aria-hidden />
              {td.recordReceipt}
            </Button>
          </Link>
        </div>
      ) : null}

      {/* Goods Receipts */}
      {(receipts ?? []).length > 0 ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.receipts}</h2>
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-start font-semibold">{tc.number}</th>
                  <th className="py-2 text-start font-semibold">{tc.deliveryDate}</th>
                  <th className="py-2 text-start font-semibold">{tc.status}</th>
                </tr>
              </thead>
              <tbody>
                {(receipts ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2">
                      <Link
                        href={`/procurement/goods-receipts/${r.id}`}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        dir="ltr"
                      >
                        {r.receipt_number}
                      </Link>
                    </td>
                    <td className="py-2">{r.delivery_date}</td>
                    <td className="py-2"><CommercialStatusBadge status={r.status} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      {/* Activity */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{td.activity}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">{td.noActivity}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 border-b border-line pb-2">
                <span dir="ltr" className="font-mono text-xs text-ink">{a.action.replaceAll(".", " · ")}</span>
                <span className="text-muted">{new Date(a.created_at).toLocaleString(intlLocale(locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
