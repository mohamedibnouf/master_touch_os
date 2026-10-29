import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertAttendanceShiftAction } from "@/server/use-cases/attendance";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function HrAttendanceShiftsPage() {
  authorize(await getAuthContext(), "attendance.manage_shifts");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { t, locale } = await getI18n();
  const tsh = t.attendance.shifts;
  const tc = t.attendance.common;

  const supabase = await createServerSupabaseClient();
  const repo = new AttendanceRepository(supabase);
  const [shifts, policies] = await Promise.all([
    repo.listShifts(ctx.organization.id),
    repo.listPolicies(ctx.organization.id, true),
  ]);
  const policyName = (p: { name_ar: string; name_en: string }) => pickLocalized(locale, p.name_ar, p.name_en);
  const policyMap = new Map(policies.map((p) => [p.id, policyName(p)]));

  return (
    <PageContainer data-testid="attendance-shifts" className="space-y-5">
      <PageHeader title={tsh.title} description={tsh.description} />

      <Card data-testid="attendance-shift-form">
        <h2 className="mb-4 text-sm font-semibold text-ink">{tsh.formTitle}</h2>
        <ServerActionForm action={upsertAttendanceShiftAction} className="grid gap-3 md:grid-cols-2">
          <Field label={tsh.policy} required>
            <Select name="policy_id" required>
              <option value="">{tc.choose}</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {policyName(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tc.code} required>
            <Input name="code" required placeholder="STD_DAY" className="font-mono" />
          </Field>
          <Field label={tc.nameAr} required>
            <Input name="name_ar" required dir="rtl" />
          </Field>
          <Field label={tc.nameEn} required>
            <Input name="name_en" required dir="ltr" />
          </Field>
          <Field label={tsh.start} required>
            <Input name="start_time" required placeholder="08:00" defaultValue="08:00" dir="ltr" />
          </Field>
          <Field label={tsh.end} required>
            <Input name="end_time" required placeholder="17:00" defaultValue="17:00" dir="ltr" />
          </Field>
          <Field label={tsh.breakMinutes}>
            <Input name="break_minutes" type="number" defaultValue={60} />
          </Field>
          <Field label={tsh.workingDays} required>
            <Input name="working_days" defaultValue="0,1,2,3,4" required dir="ltr" />
          </Field>
          <Field label={tsh.crossesMidnight}>
            <Select name="crosses_midnight" defaultValue="false">
              <option value="false">{tc.no}</option>
              <option value="true">{tc.yes}</option>
            </Select>
          </Field>
          <Field label={tc.activeQuestion}>
            <Select name="is_active" defaultValue="true">
              <option value="true">{tc.yes}</option>
              <option value="false">{tc.no}</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" className="w-full sm:w-auto">
              {tsh.save}
            </Button>
          </div>
        </ServerActionForm>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <TableScroll>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.code}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.name}</th>
                <th className="px-4 py-3 text-start font-medium">{tsh.policy}</th>
                <th className="px-4 py-3 text-start font-medium">{tsh.timeColumn}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.active}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3 font-medium text-ink">{pickLocalized(locale, s.name_ar, s.name_en)}</td>
                  <td className="px-4 py-3">{policyMap.get(s.policy_id) ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span dir="ltr">
                      {String(s.start_time).slice(0, 5)} → {String(s.end_time).slice(0, 5)}
                      {s.crosses_midnight ? " *" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={s.is_active ? "success" : "neutral"}>{s.is_active ? tc.yes : tc.no}</Badge>
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
