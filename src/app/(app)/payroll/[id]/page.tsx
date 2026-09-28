import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { isUuid } from "@/lib/utils";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  approvePayrollPeriodAction,
  calculatePayrollPeriodAction,
  cancelPayrollPeriodAction,
  lockPayrollPeriodAction,
  markPayrollReviewedAction,
  submitPayrollForReviewAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

function statusTone(status: string): "neutral" | "success" | "danger" | "warning" | "navy" {
  if (status === "paid" || status === "locked" || status === "approved") return "success";
  if (status === "cancelled") return "danger";
  if (status === "under_review" || status === "calculated") return "warning";
  return "navy";
}

export default async function PayrollPeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canView =
    hasPermission(ctx, "payroll.view_all") ||
    hasPermission(ctx, "payroll.prepare") ||
    hasPermission(ctx, "payroll.calculate") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.adjust") ||
    hasPermission(ctx, "payroll.record_payment") ||
    hasPermission(ctx, "payroll.lock");
  if (!canView) redirect("/my/payslips");

  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const period = await repo.getPeriod(ctx.organization.id, id);
  if (!period) notFound();

  const status = period.status;
  const canCalculate =
    hasPermission(ctx, "payroll.calculate") && (status === "draft" || status === "calculated");
  const canSubmit = hasPermission(ctx, "payroll.prepare") && status === "calculated";
  const canReview = hasPermission(ctx, "payroll.review") && status === "under_review";
  const canApprove = hasPermission(ctx, "payroll.approve") && status === "under_review";
  const canLock = hasPermission(ctx, "payroll.lock") && status === "approved";
  const canCancel =
    hasPermission(ctx, "payroll.prepare") && (status === "draft" || status === "calculated");

  return (
    <PageContainer data-testid="payroll-period-detail" className="space-y-5">
      <PageHeader
        title={`مسير ${period.year}/${String(period.month).padStart(2, "0")}`}
        description={`${period.period_start} → ${period.period_end}`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}/employees`}>
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-employees-link">
                الموظفون
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/review`}>
              <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-review-link">
                المراجعة
              </Button>
            </Link>
            <Link href="/payroll">
              <Button variant="secondary" className="w-full sm:w-auto">
                العودة
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <p className="mt-1">
            <Badge tone={statusTone(status)} data-testid="payroll-period-status">
              {payrollPeriodStatusLabel(status)}
            </Badge>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الموظفون</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{period.employee_count}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">إجمالي الاستحقاقات</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums">{formatSar(period.total_gross)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">صافي الرواتب</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums" data-testid="payroll-period-net">
            {formatSar(period.total_net)}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">الإجراءات</h2>
        <div className="flex flex-wrap gap-2">
          {canCalculate ? (
            <ServerActionForm action={calculatePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-calculate-btn">
                احتساب
              </Button>
            </ServerActionForm>
          ) : null}
          {canSubmit ? (
            <ServerActionForm action={submitPayrollForReviewAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-submit-btn">
                إرسال للمراجعة
              </Button>
            </ServerActionForm>
          ) : null}
          {canReview ? (
            <ServerActionForm action={markPayrollReviewedAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" variant="secondary" data-testid="payroll-review-btn">
                تأكيد المراجعة
              </Button>
            </ServerActionForm>
          ) : null}
          {canApprove ? (
            <ServerActionForm action={approvePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-approve-btn">
                اعتماد
              </Button>
            </ServerActionForm>
          ) : null}
          {canLock ? (
            <ServerActionForm action={lockPayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-lock-btn">
                قفل
              </Button>
            </ServerActionForm>
          ) : null}
        </div>

        {canCancel ? (
          <ServerActionForm action={cancelPayrollPeriodAction} className="mt-4 grid gap-3 sm:grid-cols-3" testId="payroll-cancel-form">
            <input type="hidden" name="periodId" value={period.id} />
            <Field label="سبب الإلغاء">
              <Input name="reason" required minLength={3} placeholder="سبب الإلغاء" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full sm:w-auto" data-testid="payroll-cancel-btn">
                إلغاء الفترة
              </Button>
            </div>
          </ServerActionForm>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy">ملخص المبالغ</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">الاستحقاقات</dt>
            <dd className="font-medium tabular-nums">{formatSar(period.total_gross)}</dd>
          </div>
          <div>
            <dt className="text-muted">الخصومات</dt>
            <dd className="font-medium tabular-nums">{formatSar(period.total_deductions)}</dd>
          </div>
          <div>
            <dt className="text-muted">الصافي</dt>
            <dd className="font-medium tabular-nums">{formatSar(period.total_net)}</dd>
          </div>
        </dl>
      </Card>
    </PageContainer>
  );
}
