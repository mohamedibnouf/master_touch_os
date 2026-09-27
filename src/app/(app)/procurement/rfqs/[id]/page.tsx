import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { issueRfqAction, updateRfqSupplierResponseAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "rfq.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const rfq = await repo.getRfq(id);
  if (!rfq) notFound();

  const audit = await repo.getAuditForEntity("rfq", id);
  const project = Array.isArray(rfq.projects) ? rfq.projects[0] : rfq.projects;
  const items = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const invitations = (rfq.rfq_suppliers as Array<Record<string, unknown>>) ?? [];

  const canIssue =
    ["draft", "ready_to_issue"].includes(rfq.status) &&
    hasPermission(ctx, "rfq.issue") &&
    invitations.length > 0;

  const isIssued = ["issued", "responses_received", "under_comparison", "awarded"].includes(rfq.status);
  const canManageResponse = hasPermission(ctx, "rfq.manage");

  // Quotations for this RFQ
  const { data: quotations } = await supabase
    .from("supplier_quotations")
    .select("id, quotation_number, status, total, currency, quotation_date, suppliers(legal_name)")
    .eq("rfq_id", id)
    .order("created_at", { ascending: false });

  const pr = Array.isArray(rfq.purchase_requests) ? rfq.purchase_requests[0] : rfq.purchase_requests;

  // Comparison
  const { data: comparison } = await supabase
    .from("quotation_comparisons")
    .select("id, status, recommended_supplier_id")
    .eq("rfq_id", id)
    .maybeSingle();

  return (
    <div>
      <PageHeader
        title={rfq.rfq_number}
        description={rfq.title}
        actions={
          <Link href="/procurement/rfqs" className="text-sm underline">
            العودة للسجل
          </Link>
        }
      />

      {/* Status row */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={rfq.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المشروع</p>
          <p className="mt-2 text-sm font-medium">
            {project ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}` : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">موعد الرد</p>
          <p className="mt-2 font-semibold">{rfq.response_due_date ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">طلب الشراء الأصلي</p>
          {pr ? (
            <p className="mt-2 text-sm text-navy font-medium">{(pr as Record<string, string>).pr_number}</p>
          ) : (
            <p className="mt-2 text-sm text-muted">—</p>
          )}
        </Card>
      </div>

      {/* Issue action */}
      {canIssue ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">إصدار طلب عروض الأسعار</h2>
          <p className="mb-3 text-sm text-muted">
            بعد الإصدار، لن يمكن تعديل البيانات التجارية.
          </p>
          <ServerActionForm action={issueRfqAction}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <Button type="submit">إصدار RFQ</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Actions after issue */}
      {isIssued ? (
        <div className="mb-6 flex flex-wrap gap-3">
          {hasPermission(ctx, "quotation.create") ? (
            <Link
              href={`/procurement/rfqs/${id}/quotations/new`}
              className="inline-flex items-center rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              + تسجيل عرض سعر
            </Link>
          ) : null}
          {(quotations ?? []).length >= 1 && hasPermission(ctx, "quotation.compare") ? (
            <Link
              href={`/procurement/rfqs/${id}/comparison`}
              className="inline-flex items-center rounded-md border border-navy px-4 py-2 text-sm font-medium text-navy hover:bg-navy/5"
            >
              مقارنة العروض →
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Items */}
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">بنود الطلب</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">لا توجد بنود.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">#</th>
                  <th className="py-2 text-right">الوصف</th>
                  <th className="py-2 text-right">الكمية</th>
                  <th className="py-2 text-right">الوحدة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="py-2">{String(item.line_no)}</td>
                    <td className="py-2">{String(item.description)}</td>
                    <td className="py-2">{String(item.quantity)}</td>
                    <td className="py-2">{String(item.unit ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Invitations */}
      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">الموردون المدعوون</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">لم يتم دعوة أي موردين.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">المورد</th>
                  <th className="py-2 text-right">حالة الرد</th>
                  {canManageResponse ? <th className="py-2 text-right">تحديث</th> : null}
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const supplier = Array.isArray(inv.suppliers) ? inv.suppliers[0] : inv.suppliers;
                  return (
                    <tr key={String(inv.id)} className="border-t border-line">
                      <td className="py-2">
                        {supplier
                          ? `${(supplier as Record<string, string>).supplier_code} — ${(supplier as Record<string, string>).legal_name}`
                          : String(inv.supplier_id)}
                      </td>
                      <td className="py-2">
                        <CommercialStatusBadge status={String(inv.response_status)} />
                      </td>
                      {canManageResponse ? (
                        <td className="py-2">
                          {String(inv.response_status) === "invited" ? (
                            <div className="flex gap-2">
                              <ServerActionForm action={updateRfqSupplierResponseAction}>
                                <input type="hidden" name="invitationId" value={String(inv.id)} />
                                <input type="hidden" name="responseStatus" value="acknowledged" />
                                <Button type="submit" variant="secondary">أقرّ</Button>
                              </ServerActionForm>
                              <ServerActionForm action={updateRfqSupplierResponseAction}>
                                <input type="hidden" name="invitationId" value={String(inv.id)} />
                                <input type="hidden" name="responseStatus" value="declined" />
                                <Button type="submit" variant="danger">رفض</Button>
                              </ServerActionForm>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Quotations received */}
      {(quotations ?? []).length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">عروض الأسعار المستلمة</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">الرقم</th>
                  <th className="py-2 text-right">المورد</th>
                  <th className="py-2 text-right">التاريخ</th>
                  <th className="py-2 text-right">الإجمالي</th>
                  <th className="py-2 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(quotations ?? []).map((q) => {
                  const sup = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <tr key={q.id} className="border-t border-line">
                      <td className="py-2">
                        <Link href={`/procurement/quotations/${q.id}`} className="font-medium text-navy underline">
                          {q.quotation_number}
                        </Link>
                      </td>
                      <td className="py-2">{(sup as Record<string, string> | null)?.legal_name ?? "—"}</td>
                      <td className="py-2">{q.quotation_date}</td>
                      <td className="py-2 tabular-nums">{Number(q.total).toLocaleString("ar-SA", { minimumFractionDigits: 2 })} {q.currency}</td>
                      <td className="py-2"><CommercialStatusBadge status={q.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Comparison / award status */}
      {comparison ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">حالة المقارنة والترسية</h2>
          <CommercialStatusBadge status={comparison.status} />
          {comparison.status === "awarded" ? (
            <p className="mt-2 text-sm text-success font-medium">تمت الترسية بنجاح ✓</p>
          ) : null}
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
                <span className="text-ink">{a.action.replaceAll(".", " · ")}</span>
                <span className="text-muted">{new Date(a.created_at).toLocaleString("ar-SA")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
