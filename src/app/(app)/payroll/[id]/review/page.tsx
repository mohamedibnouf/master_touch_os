import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import {
  approvePayrollPeriodAction,
  lockPayrollPeriodAction,
  markPayrollReviewedAction,
} from "@/server/use-cases/payroll";
import { payrollPeriodStatusLabel } from "@/lib/hr/labels";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

export default async function PayrollReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canView =
    hasPermission(ctx, "payroll.view_all") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.lock") ||
    hasPermission(ctx, "payroll.prepare");
  if (!canView) redirect("/payroll");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const period = await repo.getPeriod(ctx.organization.id, id);
  if (!period) notFound();

  const entries = await repo.listEntries(period.id);
  const status = period.status;
  const canReview = hasPermission(ctx, "payroll.review") && status === "under_review";
  const canApprove = hasPermission(ctx, "payroll.approve") && status === "under_review";
  const canLock = hasPermission(ctx, "payroll.lock") && status === "approved";

  return (
    <div data-testid="payroll-review">
      <PageHeader
        title={`مراجعة مسير ${period.year}/${String(period.month).padStart(2, "0")}`}
        description="ملخص للمراجعة والاعتماد والقفل"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={`/payroll/${period.id}`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                تفاصيل الفترة
              </Button>
            </Link>
            <Link href={`/payroll/${period.id}/employees`}>
              <Button variant="secondary" className="w-full sm:w-auto">
                الموظفون
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <p className="mt-1">
            <Badge data-testid="payroll-review-status">{payrollPeriodStatusLabel(status)}</Badge>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">عدد القيود</p>
          <p className="mt-1 text-2xl font-semibold text-navy">{entries.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الخصومات</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums">{formatSar(period.total_deductions)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">صافي المسير</p>
          <p className="mt-1 text-xl font-semibold text-navy tabular-nums">{formatSar(period.total_net)}</p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 font-semibold text-navy">إجراءات المراجعة</h2>
        <div className="flex flex-wrap gap-2">
          {canReview ? (
            <form action={markPayrollReviewedAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-review-action">
                تأكيد المراجعة
              </Button>
            </form>
          ) : null}
          {canApprove ? (
            <form action={approvePayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-approve-action">
                اعتماد المسير
              </Button>
            </form>
          ) : null}
          {canLock ? (
            <form action={lockPayrollPeriodAction}>
              <input type="hidden" name="periodId" value={period.id} />
              <Button type="submit" data-testid="payroll-lock-action">
                قفل المسير
              </Button>
            </form>
          ) : null}
          {!canReview && !canApprove && !canLock ? (
            <p className="text-sm text-muted">لا توجد إجراءات متاحة للحالة الحالية أو صلاحياتك.</p>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy">أعلى صافي رواتب</h2>
        <ul className="space-y-2 text-sm">
          {[...entries]
            .sort((a, b) => b.net_pay - a.net_pay)
            .slice(0, 10)
            .map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2"
                data-testid="payroll-review-entry"
              >
                <span>{e.employee_name ?? e.employee_number ?? e.id.slice(0, 8)}</span>
                <span className="tabular-nums font-medium">{formatSar(e.net_pay)}</span>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
