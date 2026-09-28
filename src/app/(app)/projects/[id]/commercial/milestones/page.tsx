import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader, Textarea } from "@/components/ui/primitives";
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

  const contract = await repo.getProjectContractByProject(projectId);
  const milestones = contract ? await repo.listContractMilestones(contract.id) : [];
  const canManage = hasPermission(ctx, "finance.manage");
  const nextNumber = milestones.length > 0 ? Math.max(...milestones.map((m) => m.milestone_number)) + 1 : 1;

  return (
    <PageContainer data-testid="project-milestones-page" className="space-y-5">
      <PageHeader
        title="مراحل الدفع"
        description={`${project.project_code} — ${project.name_ar}`}
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/projects/${projectId}/commercial/contract`} className="underline">
              العقد
            </Link>
            <Link href={`/projects/${projectId}/commercial/cashflow`} className="underline">
              التدفق النقدي
            </Link>
          </div>
        }
      />

      {!contract ? (
        <Card>
          <p className="mb-3 text-sm text-muted">يجب إنشاء عقد المشروع أولاً قبل تعريف مراحل الدفع.</p>
          {canManage ? (
            <Link
              href={`/projects/${projectId}/commercial/contract`}
              className="inline-flex rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white"
            >
              إنشاء العقد
            </Link>
          ) : null}
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-navy">مراحل العقد {contract.contract_number}</h2>
              <CommercialStatusBadge status={contract.status} />
            </div>
            {milestones.length === 0 ? (
              <EmptyState title="لا توجد مراحل بعد." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="milestones-table">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-2 text-right">#</th>
                      <th className="py-2 text-right">الوصف</th>
                      <th className="py-2 text-right">النسبة</th>
                      <th className="py-2 text-right">المبلغ</th>
                      <th className="py-2 text-right">التاريخ المخطط</th>
                      <th className="py-2 text-right">الحالة</th>
                      <th className="py-2 text-right">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m) => (
                      <tr key={m.id} className="border-t border-line">
                        <td className="py-2">{m.milestone_number}</td>
                        <td className="py-2">{m.description}</td>
                        <td className="py-2">{m.percentage != null ? `${m.percentage}%` : "—"}</td>
                        <td className="py-2">
                          <MoneyDisplay amount={m.amount} currency={contract.currency} />
                        </td>
                        <td className="py-2">{m.planned_date ?? "—"}</td>
                        <td className="py-2">
                          <CommercialStatusBadge status={m.status} />
                        </td>
                        <td className="py-2">
                          {canManage && m.status === "planned" ? (
                            <ServerActionForm action={markMilestoneEligibleAction} className="flex flex-wrap gap-2">
                              <input type="hidden" name="milestoneId" value={m.id} />
                              <input type="hidden" name="projectId" value={projectId} />
                              <Input
                                name="comments"
                                placeholder="ملاحظات..."
                                className="h-8 min-w-[120px] text-xs"
                              />
                              <Button type="submit" variant="secondary" data-testid={`milestone-eligible-${m.id}`}>
                                تأهيل
                              </Button>
                            </ServerActionForm>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {canManage ? (
            <Card data-testid="milestone-create-card">
              <h2 className="mb-4 font-semibold text-navy">إضافة مرحلة</h2>
              <ServerActionForm action={createContractMilestoneAction} className="grid gap-4" data-testid="milestone-create-form">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="contractId" value={contract.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="رقم المرحلة">
                    <Input
                      name="milestoneNumber"
                      type="number"
                      min="1"
                      required
                      defaultValue={String(nextNumber)}
                      data-testid="milestone-number"
                    />
                  </Field>
                  <Field label="النسبة (%)">
                    <Input name="percentage" type="number" step="0.001" min="0" max="100" />
                  </Field>
                  <Field label="المبلغ">
                    <Input name="amount" type="number" step="0.01" min="0" required defaultValue="0" data-testid="milestone-amount" />
                  </Field>
                  <Field label="التاريخ المخطط">
                    <Input name="plannedDate" type="date" />
                  </Field>
                  <Field label="حدث التفعيل">
                    <Input name="triggerEvent" placeholder="مثال: إتمام الهيكل" />
                  </Field>
                </div>
                <Field label="الاسم">
                  <Input name="name" required data-testid="milestone-name" />
                </Field>
                <Field label="الوصف">
                  <Textarea name="description" required data-testid="milestone-description" />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" data-testid="milestone-create-submit">
                    إضافة المرحلة
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
