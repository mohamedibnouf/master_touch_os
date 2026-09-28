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

  const contract = await repo.getProjectContractByProject(projectId);
  const canManage = hasPermission(ctx, "finance.manage");

  return (
    <PageContainer data-testid="project-contract-page" className="space-y-5">
      <PageHeader
        title="عقد المشروع"
        description={`${project.project_code} — ${project.name_ar}`}
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/projects/${projectId}?tab=commercial`} className="underline">
              التجاري
            </Link>
            <Link href={`/projects/${projectId}/commercial/milestones`} className="underline">
              المراحل
            </Link>
            <Link href={`/projects/${projectId}/commercial/cashflow`} className="underline">
              التدفق النقدي
            </Link>
          </div>
        }
      />

      {contract ? (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <Card>
              <p className="text-sm text-muted">الحالة</p>
              <div className="mt-2">
                <CommercialStatusBadge status={contract.status} />
              </div>
            </Card>
            <Card>
              <p className="text-sm text-muted">رقم العقد</p>
              <p className="mt-2 font-semibold text-navy">{contract.contract_number}</p>
            </Card>
            <Card>
              <p className="text-sm text-muted">العميل</p>
              <p className="mt-2 font-semibold">{contract.client_name}</p>
            </Card>
            <Card>
              <p className="text-sm text-muted">قيمة العقد</p>
              <p className="mt-2 font-bold text-navy">
                <MoneyDisplay amount={contract.contract_value} currency={contract.currency} />
              </p>
            </Card>
          </div>

          <Card className="mb-6">
            <h2 className="mb-3 font-semibold text-navy">تفاصيل العقد</h2>
            <dl className="grid gap-2 text-sm md:grid-cols-2">
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">تاريخ العقد</dt>
                <dd>{contract.contract_date ?? "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">ضريبة القيمة المضافة</dt>
                <dd>
                  <MoneyDisplay amount={contract.vat_amount} currency={contract.currency} />
                </dd>
              </div>
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">نسبة الاحتجاز</dt>
                <dd>{contract.retention_percent}%</dd>
              </div>
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">نسبة الدفعة المقدمة</dt>
                <dd>{contract.advance_payment_percent}%</dd>
              </div>
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">تاريخ البداية</dt>
                <dd>{contract.start_date ?? "—"}</dd>
              </div>
              <div className="flex justify-between border-b border-line pb-1">
                <dt className="text-muted">الإنجاز المخطط</dt>
                <dd>{contract.planned_completion ?? "—"}</dd>
              </div>
              {contract.payment_terms ? (
                <div className="md:col-span-2 border-b border-line pb-2">
                  <dt className="text-muted mb-1">شروط الدفع</dt>
                  <dd>{contract.payment_terms}</dd>
                </div>
              ) : null}
              {contract.delay_penalty_terms ? (
                <div className="md:col-span-2 border-b border-line pb-2">
                  <dt className="text-muted mb-1">غرامات التأخير</dt>
                  <dd>{contract.delay_penalty_terms}</dd>
                </div>
              ) : null}
              {contract.variation_rules ? (
                <div className="md:col-span-2">
                  <dt className="text-muted mb-1">قواعد أوامر التغيير</dt>
                  <dd>{contract.variation_rules}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {canManage && contract.status === "draft" ? (
            <Card data-testid="contract-activate-card">
              <h2 className="mb-3 font-semibold text-navy">تفعيل العقد</h2>
              <p className="mb-4 text-sm text-muted">
                بعد التفعيل لا يمكن تعديل قيمة العقد الأصلية — استخدم أوامر التغيير للزيادات.
              </p>
              <ServerActionForm action={activateProjectContractAction} data-testid="contract-activate-form">
                <input type="hidden" name="contractId" value={contract.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" data-testid="contract-activate-submit">
                  تفعيل العقد ✓
                </Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </>
      ) : canManage ? (
        <Card>
          <h2 className="mb-4 font-semibold text-navy">إنشاء عقد جديد</h2>
          <ServerActionForm action={createProjectContractAction} className="grid gap-4" data-testid="contract-create-form">
            <input type="hidden" name="projectId" value={projectId} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="اسم العميل">
                <Input name="clientName" required data-testid="contract-client-name" />
              </Field>
              <Field label="رقم العقد">
                <Input name="contractNumber" required data-testid="contract-number" />
              </Field>
              <Field label="تاريخ العقد">
                <Input name="contractDate" type="date" />
              </Field>
              <Field label="قيمة العقد (قبل الضريبة)">
                <Input name="contractValue" type="number" step="0.01" min="0" required defaultValue="0" data-testid="contract-value" />
              </Field>
              <Field label="العملة">
                <Select name="currency" defaultValue="SAR">
                  <option value="SAR">SAR</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
              <Field label="نسبة ضريبة القيمة المضافة (%)">
                <Input name="vatRate" type="number" step="0.001" min="0" defaultValue="15" />
              </Field>
              <Field label="نسبة الاحتجاز (%)">
                <Input name="retentionPercent" type="number" step="0.001" min="0" max="100" defaultValue="10" />
              </Field>
              <Field label="نسبة الدفعة المقدمة (%)">
                <Input name="advancePaymentPercent" type="number" step="0.001" min="0" max="100" defaultValue="0" />
              </Field>
              <Field label="تاريخ البداية">
                <Input name="startDate" type="date" />
              </Field>
              <Field label="الإنجاز المخطط">
                <Input name="plannedCompletion" type="date" />
              </Field>
            </div>
            <Field label="شروط الدفع">
              <Textarea name="paymentTerms" placeholder="شروط الدفع..." />
            </Field>
            <Field label="غرامات التأخير">
              <Textarea name="delayPenaltyTerms" />
            </Field>
            <Field label="قواعد أوامر التغيير">
              <Textarea name="variationRules" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="contract-create-submit">
                حفظ العقد
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">لا يوجد عقد لهذا المشروع بعد.</p>
        </Card>
      )}
    </PageContainer>
  );
}
