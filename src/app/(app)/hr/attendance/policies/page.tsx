import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AttendanceRepository } from "@/server/repositories/attendance.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertAttendancePolicyAction } from "@/server/use-cases/attendance";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function HrAttendancePoliciesPage() {
  authorize(await getAuthContext(), "attendance.manage_policies");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { t, locale } = await getI18n();
  const tp = t.attendance.policies;
  const tc = t.attendance.common;

  const supabase = await createServerSupabaseClient();
  const policies = await new AttendanceRepository(supabase).listPolicies(ctx.organization.id);

  const yesNo = (name: string) => (
    <Select name={name} defaultValue="true">
      <option value="true">{tc.yes}</option>
      <option value="false">{tc.no}</option>
    </Select>
  );

  return (
    <PageContainer data-testid="attendance-policies" className="space-y-5">
      <PageHeader title={tp.title} description={tp.description} />

      <Card data-testid="attendance-policy-form">
        <h2 className="mb-4 text-sm font-semibold text-ink">{tp.formTitle}</h2>
        <ServerActionForm action={upsertAttendancePolicyAction} className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label={tc.code} required>
              <Input name="code" required placeholder="DEFAULT" className="font-mono" />
            </Field>
          </div>
          <Field label={tc.nameAr} required>
            <Input name="name_ar" required dir="rtl" />
          </Field>
          <Field label={tc.nameEn} required>
            <Input name="name_en" required dir="ltr" />
          </Field>
          <Field label={tp.lateGrace}>
            <Input name="late_grace_minutes" type="number" defaultValue={15} />
          </Field>
          <Field label={tp.earlyLeaveGrace}>
            <Input name="early_leave_grace_minutes" type="number" defaultValue={15} />
          </Field>
          <Field label={tp.minimumWork}>
            <Input name="minimum_work_minutes" type="number" defaultValue={240} />
          </Field>
          <Field label={tp.reconciliationDelay}>
            <Input name="reconciliation_delay_hours" type="number" defaultValue={8} />
          </Field>
          <Field label={tp.allowManualCheckIn}>{yesNo("allow_manual_check_in")}</Field>
          <Field label={tp.allowManualCheckOut}>{yesNo("allow_manual_check_out")}</Field>
          <Field label={tc.activeQuestion}>{yesNo("is_active")}</Field>
          <div className="flex items-end md:col-span-2">
            <Button type="submit" className="w-full sm:w-auto">
              {tp.save}
            </Button>
          </div>
        </ServerActionForm>
      </Card>

      <Card className="overflow-hidden p-0 md:p-0">
        <TableScroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{tc.code}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.name}</th>
                <th className="px-4 py-3 text-start font-medium">{tp.lateGraceColumn}</th>
                <th className="px-4 py-3 text-start font-medium">{tp.minimumColumn}</th>
                <th className="px-4 py-3 text-start font-medium">{tc.active}</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 font-medium text-ink">{pickLocalized(locale, p.name_ar, p.name_en)}</td>
                  <td className="px-4 py-3 tabular-nums">{p.late_grace_minutes}</td>
                  <td className="px-4 py-3 tabular-nums">{p.minimum_work_minutes}</td>
                  <td className="px-4 py-3">
                    <Badge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? tc.yes : tc.no}</Badge>
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
