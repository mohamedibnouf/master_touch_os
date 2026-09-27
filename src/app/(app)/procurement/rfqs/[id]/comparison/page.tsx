import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { recommendAwardAction } from "@/server/use-cases/procurement";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "quotation.read")) redirect("/procurement");

  const { id: rfqId } = await params;
  const supabase = await createServerSupabaseClient();

  const [rfqResult, quotesResult, usersResult] = await Promise.all([
    supabase
      .from("rfqs")
      .select("id, rfq_number, title, status, rfq_items(*)")
      .eq("id", rfqId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle(),
    supabase
      .from("supplier_quotations")
      .select("*, suppliers(id, supplier_code, legal_name), supplier_quotation_items(*)")
      .eq("rfq_id", rfqId)
      .neq("status", "superseded")
      .order("total", { ascending: true }),
    supabase
      .from("organization_members")
      .select("profile_id, profiles(full_name_ar, full_name_en)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(200),
  ]);

  if (!rfqResult.data) notFound();
  const rfq = rfqResult.data;

  const { data: comparison } = await supabase
    .from("quotation_comparisons")
    .select("id, status, approval_request_id, recommended_supplier_id, recommended_quotation_id, recommendation_reason, recommended_by, recommended_at")
    .eq("rfq_id", rfqId)
    .maybeSingle();

  const approval = comparison?.approval_request_id
    ? await supabase
        .from("approval_requests")
        .select("id, status, approval_steps(*)")
        .eq("id", comparison.approval_request_id)
        .maybeSingle()
    : { data: null };

  const rfqItems = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const quotes = quotesResult.data ?? [];

  if (quotes.length === 0) {
    return (
      <div>
        <PageHeader title={`مقارنة عروض — ${rfq.rfq_number}`} description={rfq.title} />
        <Card>
          <p className="text-sm text-muted">لا توجد عروض أسعار مستلمة لهذا الطلب بعد.</p>
          <Link href={`/procurement/rfqs/${rfqId}`} className="mt-3 inline-block text-sm text-navy underline">
            العودة لـ {rfq.rfq_number}
          </Link>
        </Card>
      </div>
    );
  }

  const canRecommend =
    hasPermission(ctx, "quotation.recommend") &&
    (!comparison || ["open", "recommended"].includes(comparison.status));
  const isAwarded = comparison?.status === "awarded";
  const pendingApprovalStep = approval.data?.approval_steps?.find(
    (step: Record<string, unknown>) =>
      ["pending", "in_progress"].includes(String(step.status)) && String(step.user_id ?? "") === ctx.userId,
  ) as Record<string, unknown> | undefined;
  const canDecideAward = comparison?.status === "pending_approval" && Boolean(pendingApprovalStep);

  const users = usersResult.data ?? [];

  return (
    <div data-testid="comparison-page">
      <PageHeader
        title={`مقارنة عروض — ${rfq.rfq_number}`}
        description={rfq.title}
        actions={
          <Link href={`/procurement/rfqs/${rfqId}`} className="text-sm underline">
            العودة لـ {rfq.rfq_number}
          </Link>
        }
      />

      {isAwarded ? (
        <div className="mb-6 rounded-md bg-success/10 px-4 py-3 text-sm text-success font-medium">
          تمت الترسية بنجاح ✓ — يمكن الآن إنشاء أمر الشراء.
        </div>
      ) : null}

      {comparison && comparison.status === "pending_approval" ? (
        <div className="mb-6 rounded-md bg-warning/10 px-4 py-3 text-sm text-warning font-medium">
          التوصية بانتظار الاعتماد.
        </div>
      ) : null}

      {canDecideAward && approval.data && pendingApprovalStep ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">قرار اعتماد الترسية</h2>
          <div className="flex gap-3">
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval.data.id} />
              <input type="hidden" name="stepId" value={String(pendingApprovalStep.id)} />
              <input type="hidden" name="officialCode" value="A" />
              <Button type="submit">اعتماد ✓</Button>
            </ServerActionForm>
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval.data.id} />
              <input type="hidden" name="stepId" value={String(pendingApprovalStep.id)} />
              <input type="hidden" name="officialCode" value="D" />
              <Button type="submit" variant="danger">رفض</Button>
            </ServerActionForm>
          </div>
        </Card>
      ) : null}

      {/* Matrix */}
      <Card className="mb-6 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-right text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">البند</th>
                {quotes.map((q) => {
                  const s = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <th key={q.id} className="px-4 py-3 font-medium">
                      <Link href={`/procurement/quotations/${q.id}`} className="text-navy underline">
                        {q.quotation_number}
                      </Link>
                      <br />
                      <span className="text-xs font-normal text-muted">
                        {(s as Record<string, string> | null)?.legal_name ?? "—"}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rfqItems.map((rfqItem) => (
                <tr key={String(rfqItem.id)} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">
                    {String(rfqItem.line_no)}. {String(rfqItem.description)}
                    <br />
                    <span className="text-xs text-muted">
                      الكمية: {String(rfqItem.quantity)} {String(rfqItem.unit ?? "")}
                    </span>
                  </td>
                  {quotes.map((q) => {
                    const qItems = (q.supplier_quotation_items as Array<Record<string, unknown>>) ?? [];
                    const match = qItems.find((qi) => String(qi.rfq_item_id) === String(rfqItem.id));
                    return (
                      <td key={q.id} className="border-l border-line px-4 py-3">
                        {match ? (
                          <div className="space-y-1">
                            <div className="tabular-nums">
                              <MoneyDisplay amount={match.unit_price as number} currency={q.currency} />
                              <span className="text-muted"> / وحدة</span>
                            </div>
                            <div className="font-semibold tabular-nums">
                              <MoneyDisplay amount={match.total_price as number} currency={q.currency} />
                            </div>
                            {match.offered_brand ? (
                              <div className="text-xs text-muted">{String(match.offered_brand)} {String(match.offered_model ?? "")}</div>
                            ) : null}
                            {match.lead_time_days != null ? (
                              <div className="text-xs text-muted">{String(match.lead_time_days)} يوم</div>
                            ) : null}
                            <CommercialStatusBadge status={String(match.compliance_status ?? "not_assessed")} />
                            {match.deviation_note ? (
                              <div className="text-xs text-warning">{String(match.deviation_note)}</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Summary row */}
              <tr className="border-t-2 border-navy/20 bg-paper font-semibold">
                <td className="px-4 py-3">الإجمالي الكلي</td>
                {quotes.map((q) => (
                  <td key={q.id} className="border-l border-line px-4 py-3">
                    <div className="space-y-1 text-sm">
                      <div className="tabular-nums">
                        <MoneyDisplay amount={q.subtotal} currency={q.currency} />
                        <span className="text-xs text-muted"> إجمالي</span>
                      </div>
                      {Number(q.discount) > 0 ? (
                        <div className="text-xs text-muted">خصم: <MoneyDisplay amount={q.discount} currency={q.currency} /></div>
                      ) : null}
                      <div className="text-xs text-muted">
                        ضريبة {q.vat_rate_percent}%: <MoneyDisplay amount={q.vat_amount} currency={q.currency} />
                      </div>
                      <div className="font-bold tabular-nums text-navy">
                        <MoneyDisplay amount={q.total} currency={q.currency} />
                      </div>
                      {q.delivery_lead_time_days != null ? (
                        <div className="text-xs text-muted">تسليم: {q.delivery_lead_time_days} يوم</div>
                      ) : null}
                      {q.payment_terms ? (
                        <div className="text-xs text-muted">دفع: {q.payment_terms}</div>
                      ) : null}
                      {q.validity_date ? (
                        <div className="text-xs text-muted">صالح حتى: {q.validity_date}</div>
                      ) : null}
                      {comparison?.recommended_quotation_id === q.id ? (
                        <div className="mt-1 rounded bg-success/15 px-2 py-0.5 text-xs text-success">موصى به ✓</div>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recommendation form */}
      {canRecommend && !isAwarded ? (
        <Card data-testid="award-recommend-card">
          <h2 className="mb-4 font-semibold text-navy">توصية الترسية</h2>
          <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            ⚠️ لا يتم الترسية التلقائية للمورد الأرخص. اختر العرض المناسب وبرّر توصيتك.
          </p>
          <ServerActionForm action={recommendAwardAction} className="grid gap-4" data-testid="award-recommend-form">
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field label="العرض الموصى به">
              <Select name="quotationId" required defaultValue="" data-testid="award-quotation">
                <option value="" disabled>اختر العرض</option>
                {quotes.map((q) => {
                  const s = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <option key={q.id} value={q.id} data-supplier={q.supplier_id}>
                      {q.quotation_number} — {(s as Record<string, string> | null)?.legal_name ?? "—"} —{" "}
                      {Number(q.total).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} {q.currency}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label="المورد الموصى به">
              <Select name="supplierId" required defaultValue="" data-testid="award-supplier">
                <option value="" disabled>اختر المورد</option>
                {quotes.map((q) => {
                  const s = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <option key={q.supplier_id} value={q.supplier_id}>
                      {(s as Record<string, string> | null)?.legal_name ?? q.supplier_id}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <Field label="مبرر التوصية">
              <Textarea
                name="reason"
                required
                minLength={8}
                placeholder="وضّح أسباب اختيار هذا المورد (السعر، المطابقة الفنية، مدة التسليم، السمعة...)"
                data-testid="award-reason"
              />
            </Field>
            <Field label="المعتمد المطلوب للترسية">
              <Select name="approverProfileId" required defaultValue="" data-testid="award-approver">
                <option value="" disabled>اختر المعتمد</option>
                {users.map((u) => {
                  const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
                  return (
                    <option key={u.profile_id} value={u.profile_id}>
                      {(p as Record<string, string> | null)?.full_name_ar ??
                        (p as Record<string, string> | null)?.full_name_en ??
                        u.profile_id}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="award-submit">تقديم التوصية للاعتماد</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Show existing recommendation if not editable */}
      {comparison && !canRecommend && comparison.recommendation_reason ? (
        <Card>
          <h2 className="mb-3 font-semibold text-navy">التوصية المقدّمة</h2>
          <p className="text-sm">{comparison.recommendation_reason}</p>
          <p className="mt-2 text-xs text-muted">
            {comparison.recommended_at ? new Date(comparison.recommended_at).toLocaleString("ar-SA") : ""}
          </p>
        </Card>
      ) : null}

      {/* Award approval action — if awarded, show PO creation link */}
      {isAwarded && comparison?.recommended_quotation_id ? (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold text-navy">الخطوة التالية</h2>
          <Link
            href={`/procurement/purchase-orders/new?quotationId=${comparison.recommended_quotation_id}`}
            className="inline-flex items-center rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            إنشاء أمر الشراء →
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
