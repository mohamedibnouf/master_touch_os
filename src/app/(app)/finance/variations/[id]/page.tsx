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
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function VariationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.read")) redirect("/finance");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const variation = await repo.getVariation(id);
  if (!variation) notFound();

  const { t, locale } = await getI18n();
  const td = t.financePayables.variationDetail;
  const sources = t.financePayables.variations.sources;
  const common = t.financePayables.common;

  const { data: users } = await supabase
    .from("organization_members")
    .select("profile_id, profiles(full_name_ar, full_name_en)")
    .eq("organization_id", ctx.organization.id)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .limit(200);

  const project = Array.isArray(variation.projects) ? variation.projects[0] : variation.projects;
  const projectRow = project as Record<string, string | null> | null;
  const contract = Array.isArray(variation.project_contracts)
    ? variation.project_contracts[0]
    : variation.project_contracts;

  const source = String(variation.source ?? "other");
  const sourceLabel = Object.prototype.hasOwnProperty.call(sources, source)
    ? sources[source as keyof typeof sources]
    : commercialStatusLabel(source, locale);

  const canSubmit = hasPermission(ctx, "variation.submit") && variation.status === "draft";
  const canApprove =
    hasPermission(ctx, "variation.approve") &&
    ["under_review", "submitted", "negotiation"].includes(variation.status);

  const rowClass = "flex items-baseline justify-between gap-4 border-b border-line pb-2";

  return (
    <PageContainer data-testid="variation-detail-page" className="space-y-5">
      <PageHeader
        title={variation.vo_number}
        description={
          projectRow
            ? format(common.projectOption, {
                code: projectRow.project_code ?? "",
                name: pickLocalized(locale, projectRow.name_ar, projectRow.name_en),
              })
            : ""
        }
        actions={
          <Link
            href="/finance/variations"
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {common.register}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-muted">{td.status}</p>
          <div className="mt-2">
            <CommercialStatusBadge status={variation.status} locale={locale} />
          </div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.source}</p>
          <p className="mt-2 font-semibold text-ink">{sourceLabel}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.requestedAmount}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-ink">
            <MoneyDisplay amount={variation.requested_amount ?? variation.submitted_amount} currency="SAR" locale={locale} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.approvedAmount}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-success">
            {variation.approved_amount != null ? (
              <MoneyDisplay amount={variation.approved_amount} currency="SAR" locale={locale} />
            ) : (
              common.none
            )}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-ink">{td.detailsTitle}</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          <div className={rowClass}>
            <dt className="text-muted">{td.contract}</dt>
            <dd>{(contract as Record<string, string> | null)?.contract_number ?? common.none}</dd>
          </div>
          <div className={rowClass}>
            <dt className="text-muted">{td.timeImpact}</dt>
            <dd className="tabular-nums">{format(td.timeImpactValue, { days: variation.time_impact_days ?? 0 })}</dd>
          </div>
          <div className={rowClass}>
            <dt className="text-muted">{td.costImpact}</dt>
            <dd className="text-end tabular-nums">
              {variation.cost_impact != null ? (
                <MoneyDisplay amount={variation.cost_impact} currency="SAR" locale={locale} />
              ) : (
                common.none
              )}
            </dd>
          </div>
          <div className={rowClass}>
            <dt className="text-muted">{td.submittedDate}</dt>
            <dd className="tabular-nums">{variation.submitted_date ?? common.none}</dd>
          </div>
          <div className={rowClass}>
            <dt className="text-muted">{td.approvalDate}</dt>
            <dd className="tabular-nums">{variation.approval_date ?? common.none}</dd>
          </div>
          <div className="border-b border-line pb-2 md:col-span-2">
            <dt className="mb-1 text-muted">{td.descriptionLabel}</dt>
            <dd className="text-ink">{variation.description}</dd>
          </div>
          {variation.reason ? (
            <div className="md:col-span-2">
              <dt className="mb-1 text-muted">{td.reason}</dt>
              <dd className="text-ink">{variation.reason}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {canSubmit ? (
        <Card data-testid="variation-submit-card">
          <h2 className="mb-3 font-semibold text-ink">{td.submitTitle}</h2>
          <ServerActionForm action={submitVariationAction} className="flex flex-wrap gap-3" data-testid="variation-submit-form">
            <input type="hidden" name="variationId" value={variation.id} />
            <Select name="approverId" required className="w-full sm:w-72" data-testid="variation-approver">
              <option value="">{td.chooseApprover}</option>
              {(users ?? []).map((row) => {
                const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as Record<string, string | null> | null;
                return (
                  <option key={row.profile_id} value={row.profile_id}>
                    {pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id}
                  </option>
                );
              })}
            </Select>
            <Button type="submit" data-testid="variation-submit-button">
              {td.submitButton}
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canApprove ? (
        <Card data-testid="variation-approve-card">
          <h2 className="mb-4 font-semibold text-ink">{td.approveTitle}</h2>
          <ServerActionForm action={approveVariationWithAmountAction} className="flex flex-wrap items-end gap-3" data-testid="variation-approve-form">
            <input type="hidden" name="variationId" value={variation.id} />
            <Field label={td.approvedAmountInput} required>
              <Input
                name="approvedAmount"
                type="number"
                step="0.01"
                min="0"
                required
                className="tabular-nums"
                defaultValue={String(
                  variation.requested_amount ?? variation.submitted_amount ?? variation.cost_impact ?? 0,
                )}
                data-testid="variation-approved-amount"
              />
            </Field>
            <Button type="submit" data-testid="variation-approve-submit">
              {td.approveSubmit}
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}
    </PageContainer>
  );
}
