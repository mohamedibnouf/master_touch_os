import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { adjustLeaveBalanceAction } from "@/server/use-cases/leave";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function HrLeaveBalancesPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "leave.view_all") && !hasPermission(ctx, "leave.adjust_balance")) {
    redirect("/hr/leave");
  }
  const canAdjust = hasPermission(ctx, "leave.adjust_balance");
  if (canAdjust) authorize(ctx, "leave.adjust_balance");

  const { t, locale } = await getI18n();
  const tb = t.leave.balances;
  const tc = t.leave.common;

  const year = new Date().getFullYear();
  const supabase = await createServerSupabaseClient();
  const leaveRepo = new LeaveRepository(supabase);
  const core = new CoreRepository(supabase);
  const balances = await leaveRepo.listOrgBalances(ctx.organization.id, year);
  const types = await leaveRepo.listLeaveTypes(ctx.organization.id, true);
  const employees = await core.listEmployeeNameOptions(ctx.organization.id);

  const typeMap = new Map(types.map((ty) => [ty.id, pickLocalized(locale, ty.name_ar, ty.name_en)]));
  const empMap = new Map(
    employees.map((e) => [e.id, pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id.slice(0, 8)]),
  );

  return (
    <PageContainer className="space-y-5">
      <PageHeader title={tb.title} description={format(tb.description, { year })} />

      {canAdjust ? (
        <Card data-testid="leave-balance-adjust">
          <h2 className="mb-4 text-sm font-semibold text-ink">{tb.adjustTitle}</h2>
          <ServerActionForm action={adjustLeaveBalanceAction}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={tb.employee}>
                <Select name="employeeId" required>
                  <option value="">{tb.choose}</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tb.leaveType}>
                <Select name="leaveTypeId" required>
                  {types.map((ty) => (
                    <option key={ty.id} value={ty.id}>
                      {typeMap.get(ty.id)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tb.year}>
                <Input name="year" type="number" defaultValue={year} required />
              </Field>
              <Field label={tb.adjustmentDays}>
                <Input name="adjustmentDays" type="number" step="0.5" required />
              </Field>
              <div className="md:col-span-2">
                <Field label={tb.reason}>
                  <Input name="reason" required />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Button type="submit">{tb.save}</Button>
              </div>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {balances.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tb.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colEmployee}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tc.colType}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tb.colAvailable}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tb.colUsed}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tb.colPending}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tb.colAdjustment}</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {empMap.get(b.employee_id) ?? b.employee_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5">{typeMap.get(b.leave_type_id) || "—"}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums text-primary">{b.available_days}</td>
                    <td className="px-4 py-2.5 tabular-nums">{b.used_days}</td>
                    <td className="px-4 py-2.5 tabular-nums">{b.pending_days}</td>
                    <td className="px-4 py-2.5 tabular-nums">{b.adjustment_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </PageContainer>
  );
}
