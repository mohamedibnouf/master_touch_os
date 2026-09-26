import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { CoreRepository } from "@/server/repositories/core.repository";
import { assignEmployeeWorkplaceAction, upsertWorkplaceLocationAction } from "@/server/use-cases/attendance";
import { FillCurrentLocationButton } from "@/components/attendance/fill-current-location-button";

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
  const [places, employees, assignmentRows] = await Promise.all([
    repo.listWorkplaces(ctx.organization.id),
    core.listEmployees(ctx.organization.id),
    supabase
      .from("employee_workplace_assignments")
      .select("workplace_location_id")
      .eq("organization_id", ctx.organization.id)
      .then((r) => r.data ?? []),
  ]);
  const assignedCount = new Map<string, number>();
  for (const row of assignmentRows as { workplace_location_id: string }[]) {
    assignedCount.set(row.workplace_location_id, (assignedCount.get(row.workplace_location_id) ?? 0) + 1);
  }

  return (
    <div data-testid="attendance-locations">
      <PageHeader title="مواقع العمل" description="نطاقات معتمدة لتسجيل الحضور. الموقع يُتحقق منه على الخادم فقط." />

      <Card className="mb-6" data-testid="workplace-create-form">
        <h2 className="mb-4 font-semibold text-navy">إضافة / تحديث موقع</h2>
        <form action={upsertWorkplaceLocationAction} className="grid gap-3">
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_primary" />
            موقع أساسي للمنشأة
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked />
            نشط
          </label>
          <Button type="submit">حفظ الموقع</Button>
        </form>
      </Card>

      <Card className="mb-6 overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 font-semibold text-navy">المواقع</div>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper text-muted">
            <tr>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">الإحداثيات</th>
              <th className="px-4 py-3 text-right">القطر</th>
              <th className="px-4 py-3 text-right">الدقة</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">الموظفون</th>
              <th className="px-4 py-3 text-right">تعديل</th>
            </tr>
          </thead>
          <tbody>
            {places.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  {p.name}
                  {p.is_primary ? " · أساسي" : ""}
                </td>
                <td className="px-4 py-3 dir-ltr text-left">
                  {Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}
                </td>
                <td className="px-4 py-3">{p.allowed_radius_meters} م</td>
                <td className="px-4 py-3">{p.max_accuracy_meters ?? "—"} م</td>
                <td className="px-4 py-3">{p.is_active ? "نشط" : "موقوف"}</td>
                <td className="px-4 py-3">{assignedCount.get(p.id) ?? 0}</td>
                <td className="px-4 py-3">
                  <form action={upsertWorkplaceLocationAction} className="grid min-w-[12rem] gap-1 text-xs">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="name" value={p.name} />
                    <input type="hidden" name="code" value={p.code ?? ""} />
                    <input type="hidden" name="address" value={p.address ?? ""} />
                    <input type="hidden" name="latitude" value={String(p.latitude)} />
                    <input type="hidden" name="longitude" value={String(p.longitude)} />
                    <label className="flex items-center gap-1">
                      قطر
                      <Input name="allowed_radius_meters" type="number" defaultValue={p.allowed_radius_meters} min={10} max={2000} className="h-8" />
                    </label>
                    <label className="flex items-center gap-1">
                      دقة
                      <Input
                        name="max_accuracy_meters"
                        type="number"
                        defaultValue={p.max_accuracy_meters ?? 100}
                        min={10}
                        max={1000}
                        className="h-8"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="is_active" defaultChecked={p.is_active} />
                      نشط
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="is_primary" defaultChecked={p.is_primary} />
                      أساسي
                    </label>
                    <Button type="submit" variant="secondary" className="min-h-9 text-xs">
                      حفظ
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card data-testid="workplace-assign-form">
        <h2 className="mb-4 font-semibold text-navy">تعيين موظف لموقع</h2>
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
          <Button type="submit">حفظ التعيين</Button>
        </form>
      </Card>
    </div>
  );
}
