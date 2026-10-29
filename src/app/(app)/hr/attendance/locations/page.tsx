import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
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
import { WorkplaceActionForm } from "@/components/attendance/workplace-action-form";
import { getI18n } from "@/lib/i18n/server";
import { pickLocalized } from "@/lib/i18n/config";
import { todayInRiyadh } from "@/lib/time/riyadh";

type AssignmentStatus = "upcoming" | "active" | "ended";

export default async function HrWorkplaceLocationsPage() {
  authorize(await getAuthContext(), "attendance.manage_locations");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { t, locale } = await getI18n();
  const tl = t.attendance.locations;
  const tc = t.attendance.common;

  const today = todayInRiyadh();
  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const ready = await repo.geofenceSchemaReady();
  if (!ready) {
    return (
      <PageContainer data-testid="attendance-locations" className="space-y-5">
        <PageHeader title={tl.title} description={tl.notReady} />
      </PageContainer>
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
    employees.map((e) => [e.id, pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.employee_number || e.id]),
  );

  function assignmentStatus(from: string, to: string | null): AssignmentStatus {
    if (from > today) return "upcoming";
    if (to == null || to >= today) return "active";
    return "ended";
  }
  const statusLabel: Record<AssignmentStatus, string> = {
    upcoming: tl.statusUpcoming,
    active: tl.statusActive,
    ended: tl.statusEnded,
  };
  const statusTone: Record<AssignmentStatus, "info" | "success" | "neutral"> = {
    upcoming: "info",
    active: "success",
    ended: "neutral",
  };

  return (
    <PageContainer data-testid="attendance-locations" className="space-y-5">
      <PageHeader title={tl.title} description={tl.description} />

      <Card data-testid="workplace-create-form">
        <h2 className="mb-4 text-sm font-semibold text-ink">{tl.createTitle}</h2>
        <WorkplaceSaveForm className="grid gap-3 md:grid-cols-2">
          <Field label={tc.name} required>
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label={tl.codeOptional}>
            <Input name="code" maxLength={32} className="font-mono" />
          </Field>
          <div className="md:col-span-2">
            <Field label={tl.address}>
              <Input name="address" maxLength={500} />
            </Field>
          </div>
          <Field label={tl.latitude} required>
            <Input name="latitude" type="number" step="any" required dir="ltr" />
          </Field>
          <Field label={tl.longitude} required>
            <Input name="longitude" type="number" step="any" required dir="ltr" />
          </Field>
          <div className="md:col-span-2">
            <FillCurrentLocationButton />
          </div>
          <Field label={tl.radius} required>
            <Input name="allowed_radius_meters" type="number" defaultValue={150} min={10} max={2000} required />
          </Field>
          <Field label={tl.maxAccuracy}>
            <Input name="max_accuracy_meters" type="number" defaultValue={100} min={10} max={1000} />
          </Field>
          <Field label={tl.timezone}>
            <Input name="timezone" defaultValue="Asia/Riyadh" maxLength={64} dir="ltr" />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="is_primary" />
              {tl.isPrimary}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="is_active" defaultChecked />
              {tc.active}
            </label>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" className="w-full sm:w-auto">
              {tl.save}
            </Button>
          </div>
        </WorkplaceSaveForm>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tl.listTitle}</div>
        <TableScroll>
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tl.locationColumn}</th>
                <th className="px-4 py-3 text-start font-medium">{tl.editColumn}</th>
              </tr>
            </thead>
            <tbody>
              {places.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-muted" colSpan={2}>
                    {tl.empty}
                  </td>
                </tr>
              ) : (
                places.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {p.name}
                        {p.is_primary ? <Badge tone="info">{tl.primaryBadge}</Badge> : null}
                      </p>
                      <p className="mt-1 dir-ltr text-left text-xs text-muted">
                        {Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Badge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? tc.active : tl.inactive}</Badge>
                        <span>{tl.noDeleteNote}</span>
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <WorkplaceSaveForm className="grid gap-2 text-xs" testId={`workplace-edit-${p.id}`}>
                        <input type="hidden" name="id" value={p.id} />
                        <Input name="name" defaultValue={p.name} required maxLength={160} aria-label={tc.name} />
                        <Input
                          name="code"
                          defaultValue={p.code ?? ""}
                          maxLength={32}
                          placeholder={tc.code}
                          aria-label={tc.code}
                          className="font-mono"
                        />
                        <Input
                          name="address"
                          defaultValue={p.address ?? ""}
                          maxLength={500}
                          placeholder={tl.address}
                          aria-label={tl.address}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            name="latitude"
                            type="number"
                            step="any"
                            defaultValue={String(p.latitude)}
                            required
                            dir="ltr"
                            aria-label={tl.latitude}
                          />
                          <Input
                            name="longitude"
                            type="number"
                            step="any"
                            defaultValue={String(p.longitude)}
                            required
                            dir="ltr"
                            aria-label={tl.longitude}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1 text-muted">
                            <span>{tl.radiusShort}</span>
                            <Input
                              name="allowed_radius_meters"
                              type="number"
                              defaultValue={p.allowed_radius_meters}
                              min={10}
                              max={2000}
                            />
                          </label>
                          <label className="space-y-1 text-muted">
                            <span>{tl.accuracyShort}</span>
                            <Input
                              name="max_accuracy_meters"
                              type="number"
                              defaultValue={p.max_accuracy_meters ?? 100}
                              min={10}
                              max={1000}
                            />
                          </label>
                        </div>
                        <Input
                          name="timezone"
                          defaultValue={p.timezone || "Asia/Riyadh"}
                          maxLength={64}
                          dir="ltr"
                          aria-label={tl.timezone}
                        />
                        <label className="flex items-center gap-1 text-ink">
                          <input type="checkbox" name="is_active" defaultChecked={p.is_active} />
                          {tc.active}
                        </label>
                        <label className="flex items-center gap-1 text-ink">
                          <input type="checkbox" name="is_primary" defaultChecked={p.is_primary} />
                          {tl.primaryShort}
                        </label>
                        <Button type="submit" variant="secondary" className="min-h-9 text-xs">
                          {tl.saveEdit}
                        </Button>
                      </WorkplaceSaveForm>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      <Card data-testid="workplace-assign-form">
        <h2 className="mb-1 text-sm font-semibold text-ink">{tl.assignTitle}</h2>
        <p className="mb-4 text-xs text-muted">{tl.assignHint}</p>
        <WorkplaceActionForm action={assignEmployeeWorkplaceAction} className="grid gap-3 md:grid-cols-2">
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
          <Field label={tl.location} required>
            <Select name="workplaceId" required>
              <option value="">{tc.choose}</option>
              {places
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
              {tl.addAssignment}
            </Button>
          </div>
        </WorkplaceActionForm>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0" data-testid="workplace-assignment-list">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{tl.assignmentsTitle}</div>
        <TableScroll>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.employee}</th>
                <th className="px-4 py-3 text-start font-medium">{tl.location}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.from}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.to}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.status}</th>
                <th className="px-4 py-3 text-start font-medium">{tl.actions}</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-muted" colSpan={6}>
                    {tl.noAssignments}
                  </td>
                </tr>
              ) : (
                assignments.map((a) => {
                  const status = assignmentStatus(a.effective_from, a.effective_to);
                  const canRemove = status !== "active";
                  return (
                    <tr key={a.id} className="border-t border-line">
                      <td className="px-4 py-3 font-medium text-ink">
                        {nameByEmployee.get(a.employee_id) ?? a.employee_id}
                      </td>
                      <td className="px-4 py-3">
                        {nameByWorkplace.get(a.workplace_location_id) ?? a.workplace_location_id}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{a.effective_from}</td>
                      <td className="px-4 py-3 tabular-nums">{a.effective_to ?? tc.open}</td>
                      <td className="px-4 py-3">
                        <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          {status === "active" ? (
                            <WorkplaceActionForm action={endEmployeeWorkplaceAssignmentAction}>
                              <input type="hidden" name="assignmentId" value={a.id} />
                              <input type="hidden" name="effectiveTo" value={today} />
                              <Button type="submit" variant="secondary" className="min-h-8 text-xs">
                                {tl.endAssignment}
                              </Button>
                            </WorkplaceActionForm>
                          ) : null}
                          {canRemove ? (
                            <WorkplaceActionForm action={removeEmployeeWorkplaceAssignmentAction}>
                              <input type="hidden" name="assignmentId" value={a.id} />
                              <Button type="submit" variant="secondary" className="min-h-8 text-xs">
                                {tl.removeAssignment}
                              </Button>
                            </WorkplaceActionForm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </PageContainer>
  );
}
