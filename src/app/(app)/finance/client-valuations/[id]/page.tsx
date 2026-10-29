import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Button,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  StatCard,
  Textarea,
} from "@/components/ui/primitives";
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
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function DetailRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex justify-between gap-3 pt-1 font-semibold text-ink"
          : "flex justify-between gap-3 border-b border-line pb-2"
      }
    >
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

export default async function ClientValuationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_valuation.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const td = t.financeClient.valuationDetail;
  const tc = t.financeClient.common;

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

  const money = (amount: number | string | null | undefined) => (
    <MoneyDisplay amount={amount as number} currency="SAR" locale={locale} />
  );

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
          <Link href="/finance/client-valuations" className="text-sm font-medium text-primary hover:underline">
            {tc.register}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          label={td.statusLabel}
          value={<CommercialStatusBadge status={valuation.status} locale={locale} />}
        />
        <StatCard label={td.totalClaim} tone="info" value={money(valuation.total_claim)} />
        <StatCard
          label={td.certifiedAmount}
          tone="success"
          value={valuation.certified_amount != null ? money(valuation.certified_amount) : "—"}
        />
        <StatCard label={td.due} value={<span className="text-lg">{valuation.due_date ?? "—"}</span>} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title={td.detailsTitle}>
          <dl className="grid gap-2 text-sm">
            <DetailRow label={td.period}>
              <span className="tabular-nums">
                {format(td.periodRange, {
                  start: valuation.period_start ?? "—",
                  end: valuation.period_end ?? "—",
                })}
              </span>
            </DetailRow>
            <DetailRow label={td.progress}>
              <span className="tabular-nums">
                {valuation.progress_percentage != null ? `${valuation.progress_percentage}%` : "—"}
              </span>
            </DetailRow>
            <DetailRow label={td.milestone}>
              {milestone
                ? `#${(milestone as Record<string, unknown>).milestone_number} — ${String((milestone as Record<string, unknown>).name ?? (milestone as Record<string, unknown>).description ?? "—")}`
                : "—"}
            </DetailRow>
            <DetailRow label={td.submittedDate}>
              <span className="tabular-nums">{valuation.submitted_date ?? "—"}</span>
            </DetailRow>
            <DetailRow label={td.certificationDate}>
              <span className="tabular-nums">{valuation.certification_date ?? "—"}</span>
            </DetailRow>
          </dl>
        </Section>
        <Section title={td.amountsTitle}>
          <dl className="grid gap-2 text-sm tabular-nums">
            <DetailRow label={td.grossWorkValue}>{money(valuation.gross_work_value)}</DetailRow>
            <DetailRow label={td.variations}>{money(valuation.variations_amount)}</DetailRow>
            <DetailRow label={td.retention}>{money(valuation.retention_amount)}</DetailRow>
            <DetailRow label={td.advanceRecovery}>{money(valuation.advance_recovery)}</DetailRow>
            <DetailRow label={td.currentClaim}>{money(valuation.current_claim_amount)}</DetailRow>
            <DetailRow label={td.vat}>{money(valuation.vat_amount)}</DetailRow>
            <DetailRow label={td.totalClaim} strong>
              {money(valuation.total_claim)}
            </DetailRow>
          </dl>
        </Section>
      </div>

      {valuation.notes ? (
        <Section title={td.notes}>
          <p className="whitespace-pre-line text-sm text-ink">{valuation.notes}</p>
        </Section>
      ) : null}

      {canSubmit ? (
        <div data-testid="valuation-submit-card">
          <Section title={td.submitTitle}>
            <ServerActionForm
              action={submitClientValuationForReviewAction}
              className="flex flex-wrap gap-3"
              data-testid="valuation-submit-form"
            >
              <input type="hidden" name="valuationId" value={valuation.id} />
              <Select name="approverId" required className="min-w-[200px]" data-testid="valuation-approver">
                <option value="">{td.chooseReviewer}</option>
                {(usersResult.data ?? []).map((row) => {
                  const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as Record<
                    string,
                    string | null
                  > | null;
                  return (
                    <option key={row.profile_id} value={row.profile_id}>
                      {pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id}
                    </option>
                  );
                })}
              </Select>
              <Button type="submit" data-testid="valuation-submit-button">
                {td.submitButton}
              </Button>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {canApproveInternal ? (
        <div data-testid="valuation-approve-internal-card">
          <Section title={td.approveInternalTitle}>
            <ServerActionForm action={approveClientValuationInternalAction} data-testid="valuation-approve-internal-form">
              <input type="hidden" name="valuationId" value={valuation.id} />
              <Button type="submit" data-testid="valuation-approve-internal-button">
                {td.approveInternalButton}
              </Button>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {canMarkClientReview ? (
        <div data-testid="valuation-client-review-card">
          <Section title={td.clientReviewTitle}>
            <ServerActionForm action={markValuationUnderClientReviewAction} data-testid="valuation-client-review-form">
              <input type="hidden" name="valuationId" value={valuation.id} />
              <Button type="submit" data-testid="valuation-client-review-button">
                {td.clientReviewButton}
              </Button>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {canCertify ? (
        <div data-testid="valuation-certification-card">
          <Section title={td.certificationTitle}>
            <ServerActionForm
              action={recordClientValuationCertificationAction}
              className="grid gap-4"
              data-testid="valuation-certification-form"
            >
              <input type="hidden" name="valuationId" value={valuation.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={td.clientReference}>
                  <Input
                    name="clientReference"
                    required
                    placeholder={td.clientReferencePlaceholder}
                    data-testid="cert-client-ref"
                  />
                </Field>
                <Field label={td.certifiedAmountField}>
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
                <Field label={td.certificationDateField}>
                  <Input
                    name="certificationDate"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="cert-date"
                  />
                </Field>
              </div>
              <Field label={td.comments}>
                <Textarea name="comments" placeholder={td.commentsPlaceholder} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" data-testid="cert-submit">
                  {td.certificationSubmit}
                </Button>
              </div>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {["certified", "partially_certified"].includes(valuation.status) &&
      hasPermission(ctx, "client_invoice.create") ? (
        <Section title={td.createInvoiceTitle}>
          <Link
            href={`/finance/client-invoices/new?valuationId=${valuation.id}`}
            className="inline-flex rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
            data-testid="valuation-create-invoice-link"
          >
            {td.createInvoiceLink}
          </Link>
        </Section>
      ) : null}

      <div data-testid="valuation-attachments-card">
        <Section title={td.attachmentsTitle}>
          {documents.length === 0 ? (
            <p className="mb-4 text-sm text-muted">{td.noAttachments}</p>
          ) : (
            <ul className="mb-4 space-y-2 text-sm">
              {documents.map((doc) => {
                const document = Array.isArray(doc.documents) ? doc.documents[0] : doc.documents;
                const title = (document as { title?: string } | null)?.title ?? "—";
                return (
                  <li key={doc.id} className="flex justify-between gap-3 border-b border-line pb-2">
                    <span className="text-ink">{title}</span>
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
              locale={locale}
            />
          ) : null}
        </Section>
      </div>
    </PageContainer>
  );
}
