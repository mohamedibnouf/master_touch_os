import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
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
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const backLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

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

  const { t, locale } = await getI18n();
  const td = t.procurementSourcing.requests.detail;
  const common = t.procurementSourcing.common;

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

  const project = (Array.isArray(pr.projects) ? pr.projects[0] : pr.projects) as
    | { project_code: string; name_ar: string | null; name_en?: string | null }
    | null
    | undefined;
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
    <PageContainer data-testid="pr-detail-page" className="space-y-5">
      <PageHeader
        title={pr.pr_number}
        description={
          project
            ? format(common.codeName, {
                code: project.project_code,
                name: pickLocalized(locale, project.name_ar, project.name_en),
              })
            : ""
        }
        actions={
          <Link href="/procurement/purchase-requests" className={backLinkClass}>
            {common.backToRegister}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-muted">{td.status}</p>
          <div className="mt-2">
            <CommercialStatusBadge status={pr.status} locale={locale} />
          </div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.priority}</p>
          <p className="mt-2 font-semibold text-ink">{commercialStatusLabel(pr.priority, locale)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.estimatedCost}</p>
          <p className="mt-2 text-lg font-semibold text-primary">
            <MoneyDisplay amount={pr.estimated_cost} currency={pr.currency} locale={locale} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.requiredDate}</p>
          <p className="mt-2 font-semibold tabular-nums text-ink">{pr.required_date ?? common.none}</p>
        </Card>
      </div>

      {pr.justification ? (
        <Card>
          <p className="mb-1 text-xs font-medium text-muted">{td.justification}</p>
          <p className="text-sm text-ink">{pr.justification}</p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{td.itemsTitle}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{common.noItems}</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{td.columns.line}</th>
                  <th className="px-3 py-2 text-start font-medium">{td.columns.description}</th>
                  <th className="px-3 py-2 text-start font-medium">{td.columns.quantity}</th>
                  <th className="px-3 py-2 text-end font-medium">{td.columns.estimate}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums text-muted">{String(item.line_no)}</td>
                    <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {String(item.quantity)} {String(item.unit ?? "")}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      <MoneyDisplay amount={item.estimated_total as number} currency={pr.currency} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {canSubmit ? (
        <Card data-testid="pr-submit-approval-card">
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.submitTitle}</h2>
          <ServerActionForm action={submitPurchaseRequestForApprovalAction} className="flex flex-wrap items-end gap-3" data-testid="pr-submit-approval-form">
            <input type="hidden" name="prId" value={pr.id} />
            <Select name="approverProfileId" required className="w-auto min-w-56 flex-1" data-testid="pr-approver">
              <option value="">{common.selectApprover}</option>
              {(users.data ?? []).map((row) => {
                const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as
                  | { full_name_ar: string | null; full_name_en: string | null }
                  | null;
                return (
                  <option key={row.profile_id} value={row.profile_id}>
                    {pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id}
                  </option>
                );
              })}
            </Select>
            <Button type="submit" data-testid="pr-submit-approval">{td.submit}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canApprove && pendingStep ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.decisionTitle}</h2>
          <div className="flex flex-wrap gap-3">
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="A" />
              <Button type="submit">{common.approve}</Button>
            </ServerActionForm>
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval?.id ?? ""} />
              <input type="hidden" name="stepId" value={String(pendingStep.id)} />
              <input type="hidden" name="officialCode" value="D" />
              <Button type="submit" variant="danger">{common.reject}</Button>
            </ServerActionForm>
          </div>
        </Card>
      ) : null}

      {canConvert ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.convertTitle}</h2>
          <ServerActionForm action={createRfqFromPrAction} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="prId" value={pr.id} />
            <Field label={td.rfqTitle}>
              <Input name="title" placeholder={format(td.rfqTitlePlaceholder, { number: pr.pr_number })} />
            </Field>
            <Field label={td.responseDueDate}>
              <Input name="responseDueDate" type="date" />
            </Field>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit">{td.createRfq}</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {pr.approval_request_id && approval ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.approvalTitle}</h2>
          <p className="flex items-center gap-2 text-sm">
            <span className="text-muted">{td.approvalStatus}</span>
            <CommercialStatusBadge status={approval.status ?? "pending"} locale={locale} />
          </p>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{td.attachmentsTitle}</h2>
        {hasPermission(ctx, "document.upload") ? (
          <EntityAttachmentForm
            entityType="purchase_request"
            entityId={id}
            projectId={String(pr.project_id)}
            revalidatePath={`/procurement/purchase-requests/${id}`}
            testId="pr-attachment-form"
            locale={locale}
          />
        ) : (
          <p className="text-sm text-muted">{td.noUploadPermission}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{common.activityTitle}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">{common.noActivity}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span className="text-ink">{a.action.replaceAll(".", " · ")}</span>
                <span className="tabular-nums text-muted">{new Date(a.created_at).toLocaleString(intlLocale(locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
