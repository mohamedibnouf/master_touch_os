import { PageContainer } from "@/components/layout/page-container";
import { Badge, Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  assignEmployeeShiftAction,
  deleteEmployeeShiftAssignmentAction,
  endEmployeeShiftAssignmentAction,
} from "@/server/use-cases/attendance";
import { shiftAssignmentState } from "@/modules/attendance/split-shifts";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { todayInRiyadh } from "@/lib/time/riyadh";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HrAttendanceAssignmentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ employee?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_shifts");
  const { t, locale } = await getI18n();
  const tg = t.attendance.assignments;
  const tc = t.attendance.common;
  const sp = (await searchParams) ?? {};
  const employeeFilter = sp.employee && UUID_RE.test(sp.employee) ? sp.employee : undefined;

  const today = todayInRiyadh();
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const core = new CoreRepository(supabase);
  const [assignments, allShifts, employees] = await Promise.all([
    repo.listAssignments(ctx.organization.id, employeeFilter),
    repo.listShifts(ctx.organization.id),
    core.listEmployeeNameOptions(ctx.organization.id),
  ]);
  const shifts = allShifts.filter((s) => s.is_active);

  const shiftLabel = (s: { name_ar: string; name_en: string; start_time: string; end_time: string }) =>
    `${pickLocalized(locale, s.name_ar, s.name_en)} (${String(s.start_time).slice(0, 5)}–${String(s.end_time).slice(0, 5)})`;
  const shiftMap = new Map(allShifts.map((s) => [s.id, shiftLabel(s)]));
  const empName = (e: (typeof employees)[number]) =>
    pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id.slice(0, 8);
  const empMap = new Map(employees.map((e) => [e.id, empName(e)]));

  const stateOrder = { current: 0, upcoming: 1, ended: 2 } as const;
  const rows = assignments
    .map((a) => ({ a, state: shiftAssignmentState(a, today) }))
    .sort(
      (x, y) =>
        (empMap.get(x.a.employee_id) ?? "").localeCompare(empMap.get(y.a.employee_id) ?? "", locale) ||
        stateOrder[x.state] - stateOrder[y.state] ||
        y.a.effective_from.localeCompare(x.a.effective_from),
    );
  const currentCount = new Map<string, number>();
  for (const { a, state } of rows) {
    if (state === "current") currentCount.set(a.employee_id, (currentCount.get(a.employee_id) ?? 0) + 1);
  }

  return (
    <PageContainer data-testid="attendance-assignments" className="space-y-5">
      <PageHeader title={tg.title} description={tg.description} />

      <Card data-testid="attendance-assign-form">
        <h2 className="mb-2 text-sm font-semibold text-ink">{tg.formTitle}</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted">{tg.splitHint}</p>
        <ServerActionForm action={assignEmployeeShiftAction} className="grid gap-3 md:grid-cols-2">
          <Field label={tc.employee} required>
            <Select name="employeeId" required defaultValue={employeeFilter ?? ""}>
              <option value="">{tc.choose}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tg.shift} required>
            <Select name="shiftId" required>
              <option value="">{tc.choose}</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {shiftLabel(s)}
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

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label={tg.filterEmployee}>
            <Select name="employee" defaultValue={employeeFilter ?? ""}>
              <option value="">{tc.all}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            {t.attendance.admin.apply}
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <TableScroll>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                <th className="px-4 py-3 text-start font-medium">{tg.shift}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.from}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.to}</th>
                <th className="px-4 py-3 text-start font-medium">{tg.state}</th>
                <th className="px-4 py-3 text-start font-medium">{tg.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, state }) => (
                <tr key={a.id} className="border-t border-line align-top" data-testid="attendance-assignment-row">
                  <td className="px-4 py-3 font-medium text-ink">
                    {empMap.get(a.employee_id) ?? a.employee_id.slice(0, 8)}
                    {(currentCount.get(a.employee_id) ?? 0) > 1 ? (
                      <p className="mt-0.5 text-xs font-normal text-muted">
                        {format(tg.activeShiftsCount, { n: currentCount.get(a.employee_id) ?? 0 })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{shiftMap.get(a.shift_id) ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{a.effective_from}</td>
                  <td className="px-4 py-3 tabular-nums">{a.effective_to ?? tc.open}</td>
                  <td className="px-4 py-3">
                    <Badge tone={state === "current" ? "success" : state === "upcoming" ? "info" : "neutral"}>
                      {state === "current" ? tg.current : state === "upcoming" ? tg.upcoming : tg.ended}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      {state !== "ended" ? (
                        <ServerActionForm
                          action={endEmployeeShiftAssignmentAction}
                          className="flex flex-wrap items-end gap-2"
                          testId="attendance-assignment-end"
                        >
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <label className="grid gap-1 text-xs text-muted">
                            {tg.endOn}
                            <Input
                              type="date"
                              name="effectiveTo"
                              defaultValue={a.effective_from > today ? a.effective_from : today}
                              min={a.effective_from}
                              max={a.effective_to ?? undefined}
                              required
                              className="min-w-[9rem]"
                            />
                          </label>
                          <Button type="submit" variant="secondary">
                            {tg.end}
                          </Button>
                        </ServerActionForm>
                      ) : null}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-danger">{tg.remove}</summary>
                        <p className="mt-1 max-w-xs text-muted">{tg.removeHint}</p>
                        <ServerActionForm
                          action={deleteEmployeeShiftAssignmentAction}
                          className="mt-2"
                          testId="attendance-assignment-delete"
                        >
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <Button type="submit" variant="danger">
                            {tg.remove}
                          </Button>
                        </ServerActionForm>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </PageContainer>
  );
}
