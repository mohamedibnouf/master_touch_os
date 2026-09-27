import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  assignEmployeeWorkplaceAction,
  endEmployeeWorkplaceAssignmentAction,
  removeEmployeeWorkplaceAssignmentAction,
} from "@/server/use-cases/attendance";
import { FillCurrentLocationButton } from "@/components/attendance/fill-current-location-button";
import { WorkplaceSaveForm } from "@/components/attendance/workplace-save-form";

export default async function HrWorkplaceLocationsPage() {
  authorize(await getAuthContext(), "attendance.manage_locations");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const ready = await repo.geofenceSchemaReady();
  if (!ready) {
    return (
      <div data-testid="attendance-locations">
        <PageHeader title="مواقع العمل" description="ترحيل 063 غير مطبّق بعد." />
      </div>
    );
  }
  const core = new CoreRepository(supabase);
  const [places, assignments] = await Promise.all([
    repo.listWorkplaces(ctx.organization.id),
    repo.listWorkplaceAssignments(ctx.organization.id),
  ]);
  const employees = await core.listEmployeeNameOptions(ctx.organization.id);
  const nameByWorkplace = new Map(places.map((p) => [p.id, p.name]));
  const nameByEmployee = new Map(
    employees.map((e) => [e.id, e.profiles?.full_name_ar || e.employee_number || e.id]),
  );

  function assignmentStatus(from: string, to: string | null) {
    if (from > today) return "قادم";
    if (to == null || to >= today) return "سارٍ";
    return "منتهٍ";
  }

  return (
    <div data-testid="attendance-locations">
      <PageHeader
        title="مواقع العمل"
        description="مواقع غير محدودة. الحضور يُقبل فقط من التعيينات الصريحة. الموقع الأساسي للمنشأة لا يمنح صلاحية البصمة تلقائياً."
      />

      <Card className="mb-6" data-testid="workplace-create-form">
        <h2 className="mb-4 font-semibold text-navy">إضافة موقع</h2>
        <WorkplaceSaveForm className="grid gap-3">
          <Field label="الاسم">
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label="الرمز (اختياري)">
            <Input name="code" maxLength={32} />
          </Field>
          <Field label="العنوان">
            <Input name="address" maxLength={500} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="خط العرض">
              <Input name="latitude" type="number" step="any" required />
            </Field>
            <Field label="خط الطول">
              <Input name="longitude" type="number" step="any" required />
            </Field>
          </div>
          <FillCurrentLocationButton />
          <Field label="نصف القطر بالمتر">
            <Input name="allowed_radius_meters" type="number" defaultValue={150} min={10} max={2000} required />
          </Field>
          <Field label="أقصى دقة مقبولة (متر)">
            <Input name="max_accuracy_meters" type="number" defaultValue={100} min={10} max={1000} />
          </Field>
          <Field label="المنطقة الزمنية">
            <Input name="timezone" defaultValue="Asia/Riyadh" maxLength={64} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_primary" />
            موقع أساسي للمنشأة (للعرض فقط — لا يصرّح بالحضور)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked />
            نشط
          </label>
          <Button type="submit">حفظ الموقع</Button>
        </WorkplaceSaveForm>
      </Card>

      <Card className="mb-6 overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">المواقع — تعديل / تفعيل / إيقاف</div>
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموقع</th>
              <th className="px-4 py-3 text-right">تعديل</th>
            </tr>
          </thead>
          <tbody>
            {places.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-navy">
                    {p.name}
                    {p.is_primary ? " · أساسي" : ""}
                  </p>
                  <p className="mt-1 dir-ltr text-left text-xs text-muted">
                    {Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {p.is_active ? "نشط" : "موقوف"} · لا يُحذف الموقع المرتبط بسجل حضور
                  </p>
                </td>
                <td className="px-4 py-3">
                  <WorkplaceSaveForm className="grid gap-2 text-xs" testId={`workplace-edit-${p.id}`}>
                    <input type="hidden" name="id" value={p.id} />
                    <Input name="name" defaultValue={p.name} required maxLength={160} />
                    <Input name="code" defaultValue={p.code ?? ""} maxLength={32} placeholder="الرمز" />
                    <Input name="address" defaultValue={p.address ?? ""} maxLength={500} placeholder="العنوان" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input name="latitude" type="number" step="any" defaultValue={String(p.latitude)} required />
                      <Input name="longitude" type="number" step="any" defaultValue={String(p.longitude)} required />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        قطر
                        <Input name="allowed_radius_meters" type="number" defaultValue={p.allowed_radius_meters} min={10} max={2000} />
                      </label>
                      <label>
                        دقة
                        <Input
                          name="max_accuracy_meters"
                          type="number"
                          defaultValue={p.max_accuracy_meters ?? 100}
                          min={10}
                          max={1000}
                        />
                      </label>
                    </div>
                    <Input name="timezone" defaultValue={p.timezone || "Asia/Riyadh"} maxLength={64} />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="is_active" defaultChecked={p.is_active} />
                      نشط
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="is_primary" defaultChecked={p.is_primary} />
                      أساسي للمنشأة
                    </label>
                    <Button type="submit" variant="secondary" className="min-h-9 text-xs">
                      حفظ التعديل
                    </Button>
                  </WorkplaceSaveForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mb-6" data-testid="workplace-assign-form">
        <h2 className="mb-4 font-semibold text-navy">تعيين موقع لموظف</h2>
        <p className="mb-3 text-xs text-muted">يمكن تعيين مواقع متعددة في نفس الفترة ما دامت المواقع مختلفة.</p>
        <form action={assignEmployeeWorkplaceAction} className="grid gap-3">
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
          <Field label="الموقع">
            <Select name="workplaceId" required>
              <option value="">اختر</option>
              {places.filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
          <Button type="submit">إضافة تعيين</Button>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0" data-testid="workplace-assignment-list">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">تعيينات الموظفين</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الموظف</th>
              <th className="px-4 py-3 text-right">الموقع</th>
              <th className="px-4 py-3 text-right">من</th>
              <th className="px-4 py-3 text-right">إلى</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-muted" colSpan={6}>
                  لا توجد تعيينات بعد. الموظفون بلا تعيين لا يمكنهم تسجيل الحضور.
                </td>
              </tr>
            ) : (
              assignments.map((a) => {
                const status = assignmentStatus(a.effective_from, a.effective_to);
                const canRemove = status !== "سارٍ";
                return (
                  <tr key={a.id} className="border-t border-line">
                    <td className="px-4 py-3">{nameByEmployee.get(a.employee_id) ?? a.employee_id}</td>
                    <td className="px-4 py-3">{nameByWorkplace.get(a.workplace_location_id) ?? a.workplace_location_id}</td>
                    <td className="px-4 py-3">{a.effective_from}</td>
                    <td className="px-4 py-3">{a.effective_to ?? "مفتوح"}</td>
                    <td className="px-4 py-3">{status}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        {status === "سارٍ" ? (
                          <form action={endEmployeeWorkplaceAssignmentAction}>
                            <input type="hidden" name="assignmentId" value={a.id} />
                            <input type="hidden" name="effectiveTo" value={today} />
                            <Button type="submit" variant="secondary" className="min-h-8 text-xs">
                              إنهاء التعيين
                            </Button>
                          </form>
                        ) : null}
                        {canRemove ? (
                          <form action={removeEmployeeWorkplaceAssignmentAction}>
                            <input type="hidden" name="assignmentId" value={a.id} />
                            <Button type="submit" variant="secondary" className="min-h-8 text-xs">
                              حذف التعيين
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
