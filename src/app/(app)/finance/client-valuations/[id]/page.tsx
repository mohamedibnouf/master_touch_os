import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { EntityAttachmentForm } from "@/components/commercial/entity-attachment-form";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  approveClientValuationInternalAction,
  markValuationUnderClientReviewAction,
  recordClientValuationCertificationAction,
  submitClientValuationForReviewAction,
} from "@/server/use-cases/commercial";

export default async function ClientValuationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_valuation.read")) redirect("/finance");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const valuation = await repo.getClientValuation(id);
  if (!valuation) notFound();

  const [documents, usersResult] = await Promise.all([
    repo.getEntityDocuments("client_valuation", id),
    supabase
      .from("organization_members")
      .select("profile_id, profiles(full_name_ar, full_name_en)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(200),
  ]);

  const project = Array.isArray(valuation.projects) ? valuation.projects[0] : valuation.projects;
  const contract = Array.isArray(valuation.project_contracts)
    ? valuation.project_contracts[0]
    : valuation.project_contracts;
  const milestone = Array.isArray(valuation.contract_milestones)
    ? valuation.contract_milestones[0]
    : valuation.contract_milestones;

  const canSubmit = hasPermission(ctx, "client_valuation.submit") && valuation.status === "draft";
  const canApproveInternal =
    hasPermission(ctx, "client_valuation.approve") && valuation.status === "internal_review";
  const canMarkClientReview =
    hasPermission(ctx, "client_valuation.submit") && valuation.status === "submitted";
  const canCertify =
    hasPermission(ctx, "client_valuation.approve") &&
    ["submitted", "under_client_review", "partially_certified"].includes(valuation.status);
  const canAttach = hasPermission(ctx, "document.upload");

  return (
    <PageContainer data-testid="valuation-detail-page" className="space-y-5">
      <PageHeader
        title={valuation.valuation_number}
        description={
          project
            ? `${(project as Record<string, string>).project_code} — ${(contract as Record<string, string> | null)?.client_name ?? ""}`
            : ""
        }
        actions={
          <Link href="/finance/client-valuations" className="text-sm underline">
            السجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2">
            <CommercialStatusBadge status={valuation.status} />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">إجمالي المطالبة</p>
          <p className="mt-2 font-bold text-navy">
            <MoneyDisplay amount={valuation.total_claim} currency="SAR" />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المبلغ المعتمد</p>
          <p className="mt-2 font-semibold text-success">
            {valuation.certified_amount != null ? (
              <MoneyDisplay amount={valuation.certified_amount} currency="SAR" />
            ) : (
              "—"
            )}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الاستحقاق</p>
          <p className="mt-2 font-semibold">{valuation.due_date ?? "—"}</p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy">تفاصيل المستخلص</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">الفترة</dt>
              <dd>
                {valuation.period_start ?? "—"} → {valuation.period_end ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">نسبة الإنجاز</dt>
              <dd>{valuation.progress_percentage != null ? `${valuation.progress_percentage}%` : "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">مرحلة الدفع</dt>
              <dd>
                {milestone
                  ? `#${(milestone as Record<string, unknown>).milestone_number} — ${String((milestone as Record<string, unknown>).name ?? (milestone as Record<string, unknown>).description ?? "—")}`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ التقديم</dt>
              <dd>{valuation.submitted_date ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ التصديق</dt>
              <dd>{valuation.certification_date ?? "—"}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-navy">المبالغ</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">قيمة الأعمال</dt>
              <dd>
                <MoneyDisplay amount={valuation.gross_work_value} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">أوامر التغيير</dt>
              <dd>
                <MoneyDisplay amount={valuation.variations_amount} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">الاحتجاز</dt>
              <dd>
                <MoneyDisplay amount={valuation.retention_amount} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">استرداد الدفعة المقدمة</dt>
              <dd>
                <MoneyDisplay amount={valuation.advance_recovery} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">المطالبة الحالية</dt>
              <dd>
                <MoneyDisplay amount={valuation.current_claim_amount} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">ضريبة القيمة المضافة</dt>
              <dd>
                <MoneyDisplay amount={valuation.vat_amount} currency="SAR" />
              </dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>إجمالي المطالبة</dt>
              <dd>
                <MoneyDisplay amount={valuation.total_claim} currency="SAR" />
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {valuation.notes ? (
        <Card className="mb-6">
          <p className="text-sm text-muted mb-1">ملاحظات</p>
          <p className="text-sm">{valuation.notes}</p>
        </Card>
      ) : null}

      {canSubmit ? (
        <Card className="mb-6" data-testid="valuation-submit-card">
          <h2 className="mb-3 font-semibold text-navy">تقديم للمراجعة الداخلية</h2>
          <ServerActionForm action={submitClientValuationForReviewAction} className="flex flex-wrap gap-3" data-testid="valuation-submit-form">
            <input type="hidden" name="valuationId" value={valuation.id} />
            <Select name="approverId" required className="min-w-[200px]" data-testid="valuation-approver">
              <option value="">اختر المراجع</option>
              {(usersResult.data ?? []).map((row) => {
                const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                return (
                  <option key={row.profile_id} value={row.profile_id}>
                    {(profile as Record<string, string> | null)?.full_name_ar ??
                      (profile as Record<string, string> | null)?.full_name_en ??
                      row.profile_id}
                  </option>
                );
              })}
            </Select>
            <Button type="submit" data-testid="valuation-submit-button">
              تقديم للمراجعة
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canApproveInternal ? (
        <Card className="mb-6" data-testid="valuation-approve-internal-card">
          <h2 className="mb-3 font-semibold text-navy">اعتماد داخلي</h2>
          <ServerActionForm action={approveClientValuationInternalAction} data-testid="valuation-approve-internal-form">
            <input type="hidden" name="valuationId" value={valuation.id} />
            <Button type="submit" data-testid="valuation-approve-internal-button">
              اعتماد داخلي ✓
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canMarkClientReview ? (
        <Card className="mb-6" data-testid="valuation-client-review-card">
          <h2 className="mb-3 font-semibold text-navy">إرسال للعميل</h2>
          <ServerActionForm action={markValuationUnderClientReviewAction} data-testid="valuation-client-review-form">
            <input type="hidden" name="valuationId" value={valuation.id} />
            <Button type="submit" data-testid="valuation-client-review-button">
              تحديد: قيد مراجعة العميل
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canCertify ? (
        <Card className="mb-6" data-testid="valuation-certification-card">
          <h2 className="mb-4 font-semibold text-navy">تسجيل تصديق العميل</h2>
          <ServerActionForm action={recordClientValuationCertificationAction} className="grid gap-4" data-testid="valuation-certification-form">
            <input type="hidden" name="valuationId" value={valuation.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="مرجع العميل">
                <Input name="clientReference" required placeholder="رقم اعتماد العميل" data-testid="cert-client-ref" />
              </Field>
              <Field label="المبلغ المعتمد (SAR)">
                <Input
                  name="certifiedAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={String(valuation.total_claim)}
                  data-testid="cert-amount"
                />
              </Field>
              <Field label="تاريخ التصديق">
                <Input
                  name="certificationDate"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  data-testid="cert-date"
                />
              </Field>
            </div>
            <Field label="ملاحظات">
              <Textarea name="comments" placeholder="ملاحظات التصديق..." />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="cert-submit">
                تسجيل التصديق
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {["certified", "partially_certified"].includes(valuation.status) &&
      hasPermission(ctx, "client_invoice.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">إنشاء فاتورة</h2>
          <Link
            href={`/finance/client-invoices/new?valuationId=${valuation.id}`}
            className="inline-flex rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white"
            data-testid="valuation-create-invoice-link"
          >
            فاتورة من هذا المستخلص →
          </Link>
        </Card>
      ) : null}

      <Card className="mb-6" data-testid="valuation-attachments-card">
        <h2 className="mb-4 font-semibold text-navy">المرفقات</h2>
        {documents.length === 0 ? (
          <p className="mb-4 text-sm text-muted">لا توجد مرفقات.</p>
        ) : (
          <ul className="mb-4 space-y-2 text-sm">
            {documents.map((doc) => {
              const document = Array.isArray(doc.documents) ? doc.documents[0] : doc.documents;
              const title = (document as { title?: string } | null)?.title ?? "—";
              return (
                <li key={doc.id} className="flex justify-between border-b border-line pb-2">
                  <span>{title}</span>
                  <span className="text-muted">{doc.role}</span>
                </li>
              );
            })}
          </ul>
        )}
        {canAttach ? (
          <EntityAttachmentForm
            entityType="client_valuation"
            entityId={valuation.id}
            projectId={valuation.project_id}
            revalidatePath={`/finance/client-valuations/${valuation.id}`}
            testId="valuation-attachment-form"
          />
        ) : null}
      </Card>
    </PageContainer>
  );
}
