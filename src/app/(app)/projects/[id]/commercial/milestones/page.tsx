import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader, TableScroll, Textarea } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  createContractMilestoneAction,
  markMilestoneEligibleAction,
} from "@/server/use-cases/commercial";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const navLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

export default async function ProjectMilestonesPage({ params }: { params: Promise<{ id: string }> }) {
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
  const tm = t.projectCommercial.milestones;
  const nav = t.projectCommercial.nav;
  const none = t.projectCommercial.common.none;

  const contract = await repo.getProjectContractByProject(projectId);
  const milestones = contract ? await repo.listContractMilestones(contract.id) : [];
  const canManage = hasPermission(ctx, "finance.manage");
  const nextNumber = milestones.length > 0 ? Math.max(...milestones.map((m) => m.milestone_number)) + 1 : 1;

  return (
    <PageContainer data-testid="project-milestones-page" className="space-y-5">
      <PageHeader
        title={tm.title}
        description={format(t.projectCommercial.common.projectSubtitle, {
          code: project.project_code,
          name: pickLocalized(locale, project.name_ar, project.name_en),
        })}
        actions={
          <nav className="flex flex-wrap gap-2">
            <Link href={`/projects/${projectId}/commercial/contract`} className={navLinkClass}>
              {nav.contract}
            </Link>
            <Link href={`/projects/${projectId}/commercial/cashflow`} className={navLinkClass}>
              {nav.cashflow}
            </Link>
          </nav>
        }
      />

      {!contract ? (
        <Card>
          <p className="mb-3 text-sm text-muted">{tm.contractRequired}</p>
          {canManage ? (
            <Link
              href={`/projects/${projectId}/commercial/contract`}
              className="inline-flex rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white"
            >
              {tm.createContract}
            </Link>
          ) : null}
        </Card>
      ) : (
        <>
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">
                {format(tm.tableTitle, { number: contract.contract_number })}
              </h2>
              <CommercialStatusBadge status={contract.status} locale={locale} />
            </div>
            {milestones.length === 0 ? (
              <EmptyState title={tm.empty} />
            ) : (
              <TableScroll>
                <table className="w-full text-sm" data-testid="milestones-table">
                  <thead className="bg-surface-muted text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colNumber}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colDescription}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colPercentage}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colAmount}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colPlannedDate}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colStatus}</th>
                      <th className="px-3 py-2.5 text-start font-medium">{tm.colAction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m) => (
                      <tr key={m.id} className="border-t border-line">
                        <td className="px-3 py-2.5 tabular-nums text-muted">{m.milestone_number}</td>
                        <td className="px-3 py-2.5 text-ink">{m.description}</td>
                        <td className="px-3 py-2.5 tabular-nums">{m.percentage != null ? `${m.percentage}%` : none}</td>
                        <td className="px-3 py-2.5">
                          <MoneyDisplay amount={m.amount} currency={contract.currency} locale={locale} />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{m.planned_date ?? none}</td>
                        <td className="px-3 py-2.5">
                          <CommercialStatusBadge status={m.status} locale={locale} />
                        </td>
                        <td className="px-3 py-2.5">
                          {canManage && m.status === "planned" ? (
                            <ServerActionForm action={markMilestoneEligibleAction} className="flex flex-wrap gap-2">
                              <input type="hidden" name="milestoneId" value={m.id} />
                              <input type="hidden" name="projectId" value={projectId} />
                              <Input
                                name="comments"
                                placeholder={tm.commentsPlaceholder}
                                className="h-8 min-w-[120px] text-xs"
                              />
                              <Button type="submit" variant="secondary" data-testid={`milestone-eligible-${m.id}`}>
                                {tm.markEligible}
                              </Button>
                            </ServerActionForm>
                          ) : (
                            none
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>

          {canManage ? (
            <Card data-testid="milestone-create-card">
              <h2 className="mb-4 text-sm font-semibold text-ink">{tm.createTitle}</h2>
              <ServerActionForm action={createContractMilestoneAction} className="grid gap-4" data-testid="milestone-create-form">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="contractId" value={contract.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={tm.milestoneNumber}>
                    <Input
                      name="milestoneNumber"
                      type="number"
                      min="1"
                      required
                      defaultValue={String(nextNumber)}
                      data-testid="milestone-number"
                    />
                  </Field>
                  <Field label={tm.percentageField}>
                    <Input name="percentage" type="number" step="0.001" min="0" max="100" />
                  </Field>
                  <Field label={tm.amount}>
                    <Input name="amount" type="number" step="0.01" min="0" required defaultValue="0" data-testid="milestone-amount" />
                  </Field>
                  <Field label={tm.plannedDate}>
                    <Input name="plannedDate" type="date" />
                  </Field>
                  <Field label={tm.triggerEvent}>
                    <Input name="triggerEvent" placeholder={tm.triggerEventPlaceholder} />
                  </Field>
                </div>
                <Field label={tm.name}>
                  <Input name="name" required data-testid="milestone-name" />
                </Field>
                <Field label={tm.description}>
                  <Textarea name="description" required data-testid="milestone-description" />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" data-testid="milestone-create-submit">
                    {tm.submit}
                  </Button>
                </div>
              </ServerActionForm>
            </Card>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
