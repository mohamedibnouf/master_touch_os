import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  activateProjectContractAction,
  createProjectContractAction,
} from "@/server/use-cases/commercial";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const navLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

export default async function ProjectContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "finance.read")) redirect("/projects");

  const { id: projectId } = await params;
  const supabase = await createServerSupabaseClient();
  const coreRepo = new CoreRepository(supabase);
  const repo = new CommercialRepository(supabase);
  const project = await coreRepo.getProject(ctx.organization.id, projectId);
  if (!project) notFound();

  const { t, locale } = await getI18n();
  const tc = t.projectCommercial.contract;
  const nav = t.projectCommercial.nav;
  const none = t.projectCommercial.common.none;

  const contract = await repo.getProjectContractByProject(projectId);
  const canManage = hasPermission(ctx, "finance.manage");

  return (
    <PageContainer data-testid="project-contract-page" className="space-y-5">
      <PageHeader
        title={tc.title}
        description={format(t.projectCommercial.common.projectSubtitle, {
          code: project.project_code,
          name: pickLocalized(locale, project.name_ar, project.name_en),
        })}
        actions={
          <nav className="flex flex-wrap gap-2">
            <Link href={`/projects/${projectId}?tab=commercial`} className={navLinkClass}>
              {nav.commercial}
            </Link>
            <Link href={`/projects/${projectId}/commercial/milestones`} className={navLinkClass}>
              {nav.milestones}
            </Link>
            <Link href={`/projects/${projectId}/commercial/cashflow`} className={navLinkClass}>
              {nav.cashflow}
            </Link>
          </nav>
        }
      />

      {contract ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <Card>
              <p className="text-xs font-medium text-muted">{tc.status}</p>
              <div className="mt-2">
                <CommercialStatusBadge status={contract.status} locale={locale} />
              </div>
            </Card>
            <Card>
              <p className="text-xs font-medium text-muted">{tc.contractNumber}</p>
              <p className="mt-2 font-semibold text-ink">{contract.contract_number}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-muted">{tc.client}</p>
              <p className="mt-2 font-semibold text-ink">{contract.client_name}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-muted">{tc.contractValue}</p>
              <p className="mt-2 text-lg font-semibold text-primary">
                <MoneyDisplay amount={contract.contract_value} currency={contract.currency} locale={locale} />
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink">{tc.detailsTitle}</h2>
            <dl className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.contractDate}</dt>
                <dd className="tabular-nums">{contract.contract_date ?? none}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.vatAmount}</dt>
                <dd>
                  <MoneyDisplay amount={contract.vat_amount} currency={contract.currency} locale={locale} />
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.retentionPercent}</dt>
                <dd className="tabular-nums">{contract.retention_percent}%</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.advancePaymentPercent}</dt>
                <dd className="tabular-nums">{contract.advance_payment_percent}%</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.startDate}</dt>
                <dd className="tabular-nums">{contract.start_date ?? none}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-2">
                <dt className="text-muted">{tc.plannedCompletion}</dt>
                <dd className="tabular-nums">{contract.planned_completion ?? none}</dd>
              </div>
              {contract.payment_terms ? (
                <div className="border-b border-line pb-2 md:col-span-2">
                  <dt className="mb-1 text-muted">{tc.paymentTerms}</dt>
                  <dd className="text-ink">{contract.payment_terms}</dd>
                </div>
              ) : null}
              {contract.delay_penalty_terms ? (
                <div className="border-b border-line pb-2 md:col-span-2">
                  <dt className="mb-1 text-muted">{tc.delayPenalties}</dt>
                  <dd className="text-ink">{contract.delay_penalty_terms}</dd>
                </div>
              ) : null}
              {contract.variation_rules ? (
                <div className="md:col-span-2">
                  <dt className="mb-1 text-muted">{tc.variationRules}</dt>
                  <dd className="text-ink">{contract.variation_rules}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {canManage && contract.status === "draft" ? (
            <Card data-testid="contract-activate-card">
              <h2 className="mb-2 text-sm font-semibold text-ink">{tc.activateTitle}</h2>
              <p className="mb-4 text-sm text-muted">{tc.activateHint}</p>
              <ServerActionForm action={activateProjectContractAction} data-testid="contract-activate-form">
                <input type="hidden" name="contractId" value={contract.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" data-testid="contract-activate-submit">
                  {tc.activateSubmit} ✓
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </>
      ) : canManage ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">{tc.createTitle}</h2>
          <ServerActionForm action={createProjectContractAction} className="grid gap-4" data-testid="contract-create-form">
            <input type="hidden" name="projectId" value={projectId} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={tc.clientName}>
                <Input name="clientName" required data-testid="contract-client-name" />
              </Field>
              <Field label={tc.contractNumber}>
                <Input name="contractNumber" required data-testid="contract-number" />
              </Field>
              <Field label={tc.contractDate}>
                <Input name="contractDate" type="date" />
              </Field>
              <Field label={tc.contractValueExVat}>
                <Input name="contractValue" type="number" step="0.01" min="0" required defaultValue="0" data-testid="contract-value" />
              </Field>
              <Field label={tc.currency}>
                <Select name="currency" defaultValue="SAR">
                  <option value="SAR">SAR</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
              <Field label={tc.vatRate}>
                <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
              </Field>
              <Field label={tc.retentionPercentField}>
                <Input name="retentionPercent" type="number" step="0.001" min="0" max="100" defaultValue="10" />
              </Field>
              <Field label={tc.advancePaymentPercentField}>
                <Input name="advancePaymentPercent" type="number" step="0.001" min="0" max="100" defaultValue="0" />
              </Field>
              <Field label={tc.startDate}>
                <Input name="startDate" type="date" />
              </Field>
              <Field label={tc.plannedCompletion}>
                <Input name="plannedCompletion" type="date" />
              </Field>
            </div>
            <Field label={tc.paymentTerms}>
              <Textarea name="paymentTerms" placeholder={tc.paymentTermsPlaceholder} />
            </Field>
            <Field label={tc.delayPenalties}>
              <Textarea name="delayPenaltyTerms" />
            </Field>
            <Field label={tc.variationRules}>
              <Textarea name="variationRules" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="contract-create-submit">
                {tc.save}
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">{tc.noContract}</p>
        </Card>
      )}
    </PageContainer>
  );
}
