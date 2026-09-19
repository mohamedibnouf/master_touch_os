import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { adjustLeaveBalanceAction } from "@/server/use-cases/leave";

export default async function HrLeaveBalancesPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "leave.view_all") && !hasPermission(ctx, "leave.adjust_balance")) {
    redirect("/hr/leave");
  }
  const canAdjust = hasPermission(ctx, "leave.adjust_balance");
  if (canAdjust) authorize(ctx, "leave.adjust_balance");

  const year = new Date().getFullYear();
  const supabase = await createServerSupabaseClient();
  const leaveRepo = new LeaveRepository(supabase);
  const core = new CoreRepository(supabase);
  const [balances, types, employees] = await Promise.all([
    leaveRepo.listOrgBalances(ctx.organization.id, year),
    leaveRepo.listLeaveTypes(ctx.organization.id, true),
    core.listEmployees(ctx.organization.id),
  ]);

  const typeMap = new Map(types.map((t) => [t.id, t.name_ar]));
  const empMap = new Map(
    employees.map((e) => [e.id, e.profiles?.full_name_ar || e.employee_number || e.id.slice(0, 8)]),
  );

  return (
    <div>
      <PageHeader title="أرصدة الإجازات" description={`العام ${year}`} />

      {canAdjust ? (
        <Card className="mb-6" data-testid="leave-balance-adjust">
          <h2 className="mb-4 font-semibold text-navy">تعديل رصيد</h2>
          <form action={adjustLeaveBalanceAction} className="grid gap-3 md:grid-cols-2">
            <Field label="الموظف">
              <Select name="employeeId" required>
                <option value="">اختر</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.profiles?.full_name_ar || e.employee_number || e.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="نوع الإجازة">
              <Select name="leaveTypeId" required>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السنة">
              <Input name="year" type="number" defaultValue={year} required />
            </Field>
            <Field label="أيام التعديل (+/-)">
              <Input name="adjustmentDays" type="number" step="0.5" required />
            </Field>
            <Field label="السبب">
              <Input name="reason" required className="md:col-span-2" />
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">حفظ التعديل</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموظف</th>
              <th className="px-4 py-3 text-right">النوع</th>
              <th className="px-4 py-3 text-right">المتاح</th>
              <th className="px-4 py-3 text-right">مستخدم</th>
              <th className="px-4 py-3 text-right">معلّق</th>
              <th className="px-4 py-3 text-right">تعديل</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="px-4 py-3">{empMap.get(b.employee_id) ?? b.employee_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{typeMap.get(b.leave_type_id) ?? "—"}</td>
                <td className="px-4 py-3 font-semibold text-navy">{b.available_days}</td>
                <td className="px-4 py-3">{b.used_days}</td>
                <td className="px-4 py-3">{b.pending_days}</td>
                <td className="px-4 py-3">{b.adjustment_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
