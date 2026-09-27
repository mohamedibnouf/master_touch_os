import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
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
    <div>
      <PageHeader
        title={po.po_number}
        description={`أمر شراء — ${(supplier as Record<string, string> | null)?.legal_name ?? "—"}`}
        actions={
          <div className="flex gap-3">
            <Link href="/procurement/purchase-orders" className="text-sm underline">
              السجل
            </Link>
            {isIssued ? (
              <Link
                href={`/procurement/purchase-orders/${id}/print`}
                className="inline-flex items-center rounded-md border border-navy px-3 py-1.5 text-sm text-navy hover:bg-navy/5"
                target="_blank"
              >
                طباعة PO
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={po.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المورد</p>
          <p className="mt-2 text-sm font-medium">
            {(supplier as Record<string, string> | null)?.legal_name ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الإجمالي</p>
          <p className="mt-2 font-bold text-navy">
            <MoneyDisplay amount={po.total} currency={po.currency} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">موعد التسليم</p>
          <p className="mt-2 font-semibold">{po.required_delivery_date ?? "—"}</p>
        </Card>
      </div>

      {/* Financials */}
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">المبالغ التجارية</h2>
        <dl className="grid gap-2 text-sm md:w-1/2">
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">إجمالي قبل الخصم</dt>
            <dd><MoneyDisplay amount={po.subtotal} currency={po.currency} /></dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">الخصم</dt>
            <dd><MoneyDisplay amount={po.discount} currency={po.currency} /></dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">ضريبة القيمة المضافة ({po.vat_rate_percent}%)</dt>
            <dd><MoneyDisplay amount={po.vat_amount} currency={po.currency} /></dd>
          </div>
          <div className="flex justify-between font-bold">
            <dt>الإجمالي الكلي</dt>
            <dd><MoneyDisplay amount={po.total} currency={po.currency} /></dd>
          </div>
          {po.payment_terms ? (
            <div className="flex justify-between border-t border-line pt-1">
              <dt className="text-muted">شروط الدفع</dt>
              <dd>{po.payment_terms}</dd>
            </div>
          ) : null}
          {po.delivery_terms ? (
            <div className="flex justify-between">
              <dt className="text-muted">شروط التسليم</dt>
              <dd>{po.delivery_terms}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {/* Items */}
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy">البنود</h2>
          {isIssued ? (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
              البيانات التجارية محمية — لا يمكن التعديل بعد الإصدار
            </span>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">لا توجد بنود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper text-right text-muted">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">الوصف</th>
                  <th className="px-3 py-2">الكمية المأمورة</th>
                  <th className="px-3 py-2">المستلمة</th>
                  <th className="px-3 py-2">المتبقية</th>
                  <th className="px-3 py-2">سعر الوحدة</th>
                  <th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = Number(item.quantity);
                  const received = Number(item.received_quantity ?? 0);
                  const remaining = Math.max(0, ordered - received);
                  return (
                    <tr key={String(item.id)} className="border-t border-line">
                      <td className="px-3 py-2">{String(item.line_no)}</td>
                      <td className="px-3 py-2">{String(item.description)}</td>
                      <td className="px-3 py-2 tabular-nums">{ordered}</td>
                      <td className="px-3 py-2 tabular-nums text-success">{received}</td>
                      <td className={`px-3 py-2 tabular-nums ${remaining > 0 ? "text-warning" : "text-success"}`}>
                        {remaining}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        <MoneyDisplay amount={item.unit_price as number} currency={po.currency} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        <MoneyDisplay amount={item.line_total as number} currency={po.currency} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Submit for approval */}
      {canSubmitApproval ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">تقديم للاعتماد</h2>
          <ServerActionForm action={submitPurchaseOrderForApprovalAction} className="flex flex-wrap gap-3">
            <input type="hidden" name="poId" value={po.id} />
            <select name="approverProfileId" required className="h-10 rounded-md border px-3 text-sm">
              <option value="">اختر المعتمد</option>
              {(users.data ?? []).map((u) => {
                const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
                return (
                  <option key={u.profile_id} value={u.profile_id}>
                    {(p as Record<string, string> | null)?.full_name_ar ??
                      (p as Record<string, string> | null)?.full_name_en ??
                      u.profile_id}
                  </option>
                );
              })}
            </select>
            <Button type="submit">تقديم للاعتماد</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Approve / Reject */}
      {canApprove && pendingStep ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">قرار اعتماد أمر الشراء</h2>
          <div className="flex gap-3">
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="A" />
              <Button type="submit">اعتماد ✓</Button>
            </ServerActionForm>
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="D" />
              <Button type="submit" variant="danger">رفض</Button>
            </ServerActionForm>
          </div>
        </Card>
      ) : null}

      {/* Issue PO */}
      {canIssue ? (
        <Card className="mb-6" data-testid="po-issue-card">
          <h2 className="mb-3 font-semibold text-navy">إصدار أمر الشراء</h2>
          <p className="mb-3 text-sm text-muted">بعد الإصدار، تُقفل البيانات التجارية بشكل نهائي.</p>
          <ServerActionForm action={issuePurchaseOrderAction} data-testid="po-issue-form">
            <input type="hidden" name="poId" value={po.id} />
            <Button type="submit" data-testid="po-issue-submit">إصدار PO</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* GRN action */}
      {isIssued && hasPermission(ctx, "goods_receipt.create") ? (
        <div className="mb-6">
          <Link
            href={`/procurement/goods-receipts/new?poId=${id}`}
            className="inline-flex items-center rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + تسجيل استلام بضاعة
          </Link>
        </div>
      ) : null}

      {/* Goods Receipts */}
      {(receipts ?? []).length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">مستندات الاستلام</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">الرقم</th>
                  <th className="py-2 text-right">تاريخ التسليم</th>
                  <th className="py-2 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(receipts ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2">
                      <Link href={`/procurement/goods-receipts/${r.id}`} className="font-medium text-navy underline">
                        {r.receipt_number}
                      </Link>
                    </td>
                    <td className="py-2">{r.delivery_date}</td>
                    <td className="py-2"><CommercialStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Activity */}
      <Card>
        <h2 className="mb-3 font-semibold text-navy">سجل النشاط</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">لا يوجد نشاط مسجّل.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between border-b border-line pb-2">
                <span>{a.action.replaceAll(".", " · ")}</span>
                <span className="text-muted">{new Date(a.created_at).toLocaleString("ar-SA")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
