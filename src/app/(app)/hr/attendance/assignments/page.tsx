import { PageContainer } from "@/components/layout/page-container";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { assignEmployeeShiftAction } from "@/server/use-cases/attendance";

export default async function HrAttendanceAssignmentsPage() {
  const ctx = authorize(await getAuthContext(), "attendance.manage_shifts");

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const core = new CoreRepository(supabase);
  const [assignments, shifts, employees] = await Promise.all([
    repo.listAssignments(ctx.organization.id),
    repo.listShifts(ctx.organization.id, true),
    core.listEmployeeNameOptions(ctx.organization.id),
  ]);

  const shiftMap = new Map(shifts.map((s) => [s.id, s.name_ar]));
  const empMap = new Map(
    employees.map((e) => [e.id, e.profiles?.full_name_ar || e.employee_number || e.id.slice(0, 8)]),
  );

  return (
    <PageContainer data-testid="attendance-assignments" className="space-y-5">
      <PageHeader title="تعيين الورديات" description="ربط الموظفين بالورديات بتاريخ سريان" />

      <Card className="mb-6" data-testid="attendance-assign-form">
        <h2 className="mb-4 font-semibold text-navy">تعيين وردية</h2>
        <ServerActionForm action={assignEmployeeShiftAction} className="grid gap-3">
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
          <Field label="الوردية">
            <Select name="shiftId" required>
              <option value="">اختر</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ساري من">
            <Input type="date" name="effectiveFrom" defaultValue={today} required />
          </Field>
          <Field label="ساري إلى (اختياري)">
            <Input type="date" name="effectiveTo" />
          </Field>
          <Button type="submit">حفظ التعيين</Button>
        </ServerActionForm>
      </Card>

      <Card className="p-0">
        <TableScroll>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموظف</th>
              <th className="px-4 py-3 text-right">الوردية</th>
              <th className="px-4 py-3 text-right">من</th>
              <th className="px-4 py-3 text-right">إلى</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-3">{empMap.get(a.employee_id) ?? a.employee_id.slice(0, 8)}</td>
                <td className="px-4 py-3">{shiftMap.get(a.shift_id) ?? "—"}</td>
                <td className="px-4 py-3">{a.effective_from}</td>
                <td className="px-4 py-3">{a.effective_to ?? "مفتوح"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Card>
    </PageContainer>
  );
}