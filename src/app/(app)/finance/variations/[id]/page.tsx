import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import {
  approveVariationWithAmountAction,
  submitVariationAction,
} from "@/server/use-cases/commercial";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function VariationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.read")) redirect("/finance");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const variation = await repo.getVariation(id);
  if (!variation) notFound();

  const { data: users } = await supabase
    .from("organization_members")
    .select("profile_id, profiles(full_name_ar, full_name_en)")
    .eq("organization_id", ctx.organization.id)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .limit(200);

  const project = Array.isArray(variation.projects) ? variation.projects[0] : variation.projects;
  const contract = Array.isArray(variation.project_contracts)
    ? variation.project_contracts[0]
    : variation.project_contracts;

  const canSubmit = hasPermission(ctx, "variation.submit") && variation.status === "draft";
  const canApprove =
    hasPermission(ctx, "variation.approve") &&
    ["under_review", "submitted", "negotiation"].includes(variation.status);

  return (
    <PageContainer data-testid="variation-detail-page" className="space-y-5">
      <PageHeader
        title={variation.vo_number}
        description={
          project
            ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}`
            : ""
        }
        actions={
          <Link href="/finance/variations" className="text-sm underline">
            السجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2">
            <CommercialStatusBadge status={variation.status} />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">المصدر</p>
          <p className="mt-2 font-semibold">{commercialStatusLabel(String(variation.source ?? "other"))}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المبلغ المطلوب</p>
          <p className="mt-2 font-bold text-navy">
            <MoneyDisplay amount={variation.requested_amount ?? variation.submitted_amount} currency="SAR" />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المبلغ المعتمد</p>
          <p className="mt-2 font-semibold text-success">
            {variation.approved_amount != null ? (
              <MoneyDisplay amount={variation.approved_amount} currency="SAR" />
            ) : (
              "—"
            )}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">تفاصيل أمر التغيير</h2>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">العقد</dt>
            <dd>{(contract as Record<string, string> | null)?.contract_number ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">تأثير المدة</dt>
            <dd>{variation.time_impact_days} يوم</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">تاريخ التقديم</dt>
            <dd>{variation.submitted_date ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-line pb-1">
            <dt className="text-muted">تاريخ الاعتماد</dt>
            <dd>{variation.approval_date ?? "—"}</dd>
          </div>
          <div className="md:col-span-2 border-b border-line pb-2">
            <dt className="text-muted mb-1">الوصف</dt>
            <dd>{variation.description}</dd>
          </div>
          {variation.reason ? (
            <div className="md:col-span-2">
              <dt className="text-muted mb-1">السبب</dt>
              <dd>{variation.reason}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {canSubmit ? (
        <Card className="mb-6" data-testid="variation-submit-card">
          <h2 className="mb-3 font-semibold text-navy">تقديم للاعتماد</h2>
          <ServerActionForm action={submitVariationAction} className="flex flex-wrap gap-3" data-testid="variation-submit-form">
            <input type="hidden" name="variationId" value={variation.id} />
            <Select name="approverId" required data-testid="variation-approver">
              <option value="">اختر المعتمد</option>
              {(users ?? []).map((row) => {
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
            <Button type="submit" data-testid="variation-submit-button">
              تقديم للاعتماد
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canApprove ? (
        <Card className="mb-6" data-testid="variation-approve-card">
          <h2 className="mb-4 font-semibold text-navy">اعتماد بمبلغ</h2>
          <ServerActionForm action={approveVariationWithAmountAction} className="flex flex-wrap items-end gap-3" data-testid="variation-approve-form">
            <input type="hidden" name="variationId" value={variation.id} />
            <Field label="المبلغ المعتمد (SAR)">
              <Input
                name="approvedAmount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={String(
                  variation.requested_amount ?? variation.submitted_amount ?? variation.cost_impact ?? 0,
                )}
                data-testid="variation-approved-amount"
              />
            </Field>
            <Button type="submit" data-testid="variation-approve-submit">
              اعتماد ✓
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}
    </PageContainer>
  );
}
