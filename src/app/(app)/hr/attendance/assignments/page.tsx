import { PageContainer } from "@/components/layout/page-container";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { assignEmployeeShiftAction } from "@/server/use-cases/attendance";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function HrAttendanceAssignmentsPage() {
  const ctx = authorize(await getAuthContext(), "attendance.manage_shifts");
  const { t, locale } = await getI18n();
  const tg = t.attendance.assignments;
  const tc = t.attendance.common;

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const core = new CoreRepository(supabase);
  const [assignments, shifts, employees] = await Promise.all([
    repo.listAssignments(ctx.organization.id),
    repo.listShifts(ctx.organization.id, true),
    core.listEmployeeNameOptions(ctx.organization.id),
  ]);

  const shiftName = (s: { name_ar: string; name_en: string }) => pickLocalized(locale, s.name_ar, s.name_en);
  const shiftMap = new Map(shifts.map((s) => [s.id, shiftName(s)]));
  const empMap = new Map(
    employees.map((e) => [e.id, pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id.slice(0, 8)]),
  );

  return (
    <PageContainer data-testid="attendance-assignments" className="space-y-5">
      <PageHeader title={tg.title} description={tg.description} />

      <Card data-testid="attendance-assign-form">
        <h2 className="mb-4 text-sm font-semibold text-ink">{tg.formTitle}</h2>
        <ServerActionForm action={assignEmployeeShiftAction} className="grid gap-3 md:grid-cols-2">
          <Field label={tc.employee} required>
            <Select name="employeeId" required>
              <option value="">{tc.choose}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tg.shift} required>
            <Select name="shiftId" required>
              <option value="">{tc.choose}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftName(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tc.effectiveFrom} required>
            <Input type="date" name="effectiveFrom" defaultValue={today} required />
          </Field>
          <Field label={tc.effectiveToOptional}>
            <Input type="date" name="effectiveTo" />
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" className="w-full sm:w-auto">
              {tg.save}
            </Button>
          </div>
        </ServerActionForm>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                <th className="px-4 py-3 text-start font-medium">{tg.shift}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.from}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.to}</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">
                    {empMap.get(a.employee_id) ?? a.employee_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">{shiftMap.get(a.shift_id) ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{a.effective_from}</td>
                  <td className="px-4 py-3 tabular-nums">{a.effective_to ?? tc.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </PageContainer>
  );
}
