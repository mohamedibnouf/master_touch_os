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
  submitPurchaseRequestForApprovalAction,
  createRfqFromPrAction,
} from "@/server/use-cases/procurement";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { EntityAttachmentForm } from "@/components/commercial/entity-attachment-form";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function PurchaseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "purchase_request.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const pr = await repo.getPurchaseRequest(id);
  if (!pr) notFound();

  const [approval, audit, users] = await Promise.all([
    repo.getApprovalForEntity("purchase_request", id),
    repo.getAuditForEntity("purchase_request", id),
    supabase
      .from("organization_members")
      .select("profile_id, profiles(full_name_ar, full_name_en)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(200),
  ]);

  const project = Array.isArray(pr.projects) ? pr.projects[0] : pr.projects;
  const items = (pr.purchase_request_items as Array<Record<string, unknown>>) ?? [];
  const canSubmit = pr.status === "draft" && hasPermission(ctx, "purchase_request.create");
  const canApprove =
    pr.status === "under_review" &&
    hasPermission(ctx, "purchase_request.approve") &&
    approval != null;
  const canConvert = pr.status === "approved" && hasPermission(ctx, "rfq.create");

  // Find the pending step for this user
  const pendingStep = approval?.approval_steps?.find(
    (s: Record<string, unknown>) =>
      ["pending", "in_progress"].includes(String(s.status)) && String(s.user_id ?? "") === ctx.userId,
  ) as Record<string, unknown> | undefined;

  return (
    <div data-testid="pr-detail-page">
      <PageHeader
        title={pr.pr_number}
        description={project ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}` : ""}
        actions={
          <Link href="/procurement/purchase-requests" className="text-sm underline">
            العودة للسجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2">
            <CommercialStatusBadge status={pr.status} />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">الأولوية</p>
          <p className="mt-2 font-semibold">{commercialStatusLabel(pr.priority)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">التكلفة التقديرية</p>
          <p className="mt-2 font-semibold">
            <MoneyDisplay amount={pr.estimated_cost} currency={pr.currency} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">تاريخ الحاجة</p>
          <p className="mt-2 font-semibold">{pr.required_date ?? "—"}</p>
        </Card>
      </div>

      {pr.justification ? (
        <Card className="mb-6">
          <p className="text-sm text-muted mb-1">المبرر</p>
          <p className="text-sm">{pr.justification}</p>
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">البنود</h2>
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
                  <th className="py-2 text-right">التقدير</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="py-2">{String(item.line_no)}</td>
                    <td className="py-2">{String(item.description)}</td>
                    <td className="py-2">
                      {String(item.quantity)} {String(item.unit ?? "")}
                    </td>
                    <td className="py-2">
                      <MoneyDisplay amount={item.estimated_total as number} currency={pr.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canSubmit ? (
        <Card className="mb-6" data-testid="pr-submit-approval-card">
          <h2 className="mb-3 font-semibold text-navy">تقديم للاعتماد</h2>
          <ServerActionForm action={submitPurchaseRequestForApprovalAction} className="flex flex-wrap gap-3" data-testid="pr-submit-approval-form">
            <input type="hidden" name="prId" value={pr.id} />
            <select name="approverProfileId" required className="h-10 rounded-md border px-3 text-sm" data-testid="pr-approver">
              <option value="">اختر المعتمد</option>
              {(users.data ?? []).map((row) => {
                const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                return (
                  <option key={row.profile_id} value={row.profile_id}>
                    {(profile as Record<string, string> | null)?.full_name_ar ??
                      (profile as Record<string, string> | null)?.full_name_en ??
                      row.profile_id}
                  </option>
                );
              })}
            </select>
            <Button type="submit" data-testid="pr-submit-approval">تقديم للاعتماد</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canApprove && pendingStep ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">قرار الاعتماد</h2>
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

      {canConvert ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">تحويل إلى طلب عرض أسعار (RFQ)</h2>
          <ServerActionForm action={createRfqFromPrAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="prId" value={pr.id} />
            <div>
              <label className="mb-1 block text-sm font-medium">عنوان RFQ</label>
              <input name="title" placeholder={`RFQ — ${pr.pr_number}`} className="h-10 w-full rounded-md border px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">موعد الرد</label>
              <input name="responseDueDate" type="date" className="h-10 w-full rounded-md border px-3 text-sm" />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit">إنشاء RFQ →</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {pr.approval_request_id && approval ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">حالة الاعتماد</h2>
          <p className="text-sm">
            <span className="text-muted">حالة الطلب:</span>{" "}
            <CommercialStatusBadge status={approval.status ?? "pending"} />
          </p>
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">مرفقات الطلب</h2>
        {hasPermission(ctx, "document.upload") ? (
          <EntityAttachmentForm
            entityType="purchase_request"
            entityId={id}
            projectId={String(pr.project_id)}
            revalidatePath={`/procurement/purchase-requests/${id}`}
            testId="pr-attachment-form"
          />
        ) : (
          <p className="text-sm text-muted">لا توجد صلاحية رفع مرفقات.</p>
        )}
      </Card>

      <Card>
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
