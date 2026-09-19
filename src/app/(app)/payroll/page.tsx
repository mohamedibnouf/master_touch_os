import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";
import { createPayrollPeriodAction } from "@/server/use-cases/payroll";
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

export default async function PayrollDashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const canViewAll = hasPermission(ctx, "payroll.view_all");
  const canPrepare = hasPermission(ctx, "payroll.prepare");
  const canSettings = hasPermission(ctx, "payroll.manage_settings");
  const canSelf = hasPermission(ctx, "payroll.view_self");
  const canOps =
    canViewAll ||
    canPrepare ||
    hasPermission(ctx, "payroll.calculate") ||
    hasPermission(ctx, "payroll.review") ||
    hasPermission(ctx, "payroll.approve") ||
    hasPermission(ctx, "payroll.adjust") ||
    hasPermission(ctx, "payroll.record_payment") ||
    canSettings;

  if (!canOps && !canSelf) redirect("/");
  if (!canOps && canSelf) redirect("/my/payslips");

  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const periods = await repo.listPeriods(ctx.organization.id);
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  return (
    <div data-testid="payroll-dashboard">
      <PageHeader
        title="الرواتب"
        description="فترات مسير الرواتب الشهرية"
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canSelf ? (
              <Link href="/my/payslips">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-my-payslips-link">
                  قسائمي
                </Button>
              </Link>
            ) : null}
            {canSettings ? (
              <Link href="/payroll/settings">
                <Button variant="secondary" className="w-full sm:w-auto" data-testid="payroll-settings-link">
                  الإعدادات
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {canPrepare ? (
        <Card className="mb-6" data-testid="payroll-create-form">
          <h2 className="mb-3 font-semibold text-navy">إنشاء فترة رواتب</h2>
          <form action={createPayrollPeriodAction} className="grid gap-3 sm:grid-cols-3">
            <Field label="السنة">
              <Input type="number" name="year" defaultValue={defaultYear} min={2000} max={2100} required />
            </Field>
            <Field label="الشهر">
              <Select name="month" defaultValue={String(defaultMonth)} required>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full sm:w-auto" data-testid="payroll-create-submit">
                إنشاء
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">الفترات</div>
        {periods.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد فترات رواتب بعد." />
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الفترة</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">الموظفون</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
                <th className="px-4 py-3 text-right">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-t border-line" data-testid="payroll-period-row">
                  <td className="px-4 py-3">
                    <Link href={`/payroll/${p.id}`} className="font-medium text-navy underline">
                      {p.year}/{String(p.month).padStart(2, "0")}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(p.status)}>{payrollPeriodStatusLabel(p.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">{p.employee_count}</td>
                  <td className="px-4 py-3 tabular-nums">{formatSar(p.total_gross)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatSar(p.total_net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
