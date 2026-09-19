import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PayrollRepository } from "@/server/repositories/payroll.repository";

function formatSar(amount: number) {
  return `${Number(amount).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

export default async function MyPayslipsPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "payroll.view_self") && !hasPermission(ctx, "payroll.view_all")) {
    redirect("/");
  }

  if (!ctx.employee) {
    return (
      <div data-testid="my-payslips">
        <PageHeader title="قسائم الرواتب" description="لا يوجد سجل موظف مرتبط بحسابك." />
        <EmptyState title="تواصل مع الموارد البشرية لربط حسابك بملف موظف." />
      </div>
    );
  }

  const supabase = await createServerSupabaseClient();
  const repo = new PayrollRepository(supabase);
  const entries = await repo.listMyEntries(ctx.employee.id);

  const periodIds = [...new Set(entries.map((e) => e.payroll_period_id))];
  const periods = new Map<string, { year: number; month: number }>();
  await Promise.all(
    periodIds.map(async (pid) => {
      const p = await repo.getPeriod(ctx.organization.id, pid);
      if (p) periods.set(pid, { year: p.year, month: p.month });
    }),
  );

  const canOps = hasPermission(ctx, "payroll.view_all") || hasPermission(ctx, "payroll.prepare");

  return (
    <div data-testid="my-payslips">
      <PageHeader
        title="قسائمي"
        description="قسائم الرواتب المتاحة لحسابك"
        actions={
          canOps ? (
            <Link href="/payroll">
              <Button variant="secondary">إدارة الرواتب</Button>
            </Link>
          ) : null
        }
      />

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">السجل</div>
        {entries.length === 0 ? (
          <div className="p-4">
            <EmptyState title="لا توجد قسائم متاحة بعد." />
          </div>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-paper text-muted">
              <tr>
                <th className="px-4 py-3 text-right">الفترة</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
                <th className="px-4 py-3 text-right">الصافي</th>
                <th className="px-4 py-3 text-right">الصرف</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const p = periods.get(e.payroll_period_id);
                const label = p ? `${p.year}/${String(p.month).padStart(2, "0")}` : "—";
                return (
                  <tr key={e.id} className="border-t border-line" data-testid="my-payslip-row">
                    <td className="px-4 py-3">
                      <Link href={`/my/payslips/${e.id}`} className="font-medium text-navy underline">
                        {label}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatSar(e.gross_pay)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatSar(e.net_pay)}</td>
                    <td className="px-4 py-3">
                      <Badge>{e.payment_status}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
