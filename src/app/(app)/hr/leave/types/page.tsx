import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertLeaveTypeAction } from "@/server/use-cases/leave";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function HrLeaveTypesPage() {
  authorize(await getAuthContext(), "leave.manage");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { t, locale } = await getI18n();
  const tt = t.leave.types;
  const tc = t.leave.common;

  const supabase = await createServerSupabaseClient();
  const types = await new LeaveRepository(supabase).listLeaveTypes(ctx.organization.id);

  return (
    <PageContainer className="space-y-5">
      <PageHeader title={tt.title} description={tt.description} />

      <Card data-testid="leave-type-form">
        <h2 className="mb-4 text-sm font-semibold text-ink">{tt.formTitle}</h2>
        <ServerActionForm action={upsertLeaveTypeAction}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tt.code}>
              <Input name="code" required placeholder="ANNUAL" dir="ltr" />
            </Field>
            <Field label={tt.annualEntitlement}>
              <Input name="annual_entitlement_days" type="number" step="0.5" defaultValue={0} />
            </Field>
            <Field label={tt.nameAr}>
              <Input name="name_ar" required dir="rtl" />
            </Field>
            <Field label={tt.nameEn}>
              <Input name="name_en" required dir="ltr" />
            </Field>
            <Field label={tt.minimumNotice}>
              <Input name="minimum_notice_days" type="number" defaultValue={0} />
            </Field>
            <Field label={tt.maximumConsecutive}>
              <Input name="maximum_consecutive_days" type="number" />
            </Field>
            <Field label={tt.isPaid}>
              <Select name="is_paid" defaultValue="true">
                <option value="true">{tc.yes}</option>
                <option value="false">{tc.no}</option>
              </Select>
            </Field>
            <Field label={tt.requiresAttachment}>
              <Select name="requires_attachment" defaultValue="false">
                <option value="false">{tc.no}</option>
                <option value="true">{tc.yes}</option>
              </Select>
            </Field>
            <Field label={tt.carryForward}>
              <Select name="allow_carry_forward" defaultValue="false">
                <option value="false">{tc.no}</option>
                <option value="true">{tc.yes}</option>
              </Select>
            </Field>
            <Field label={tt.negativeBalance}>
              <Select name="allow_negative_balance" defaultValue="false">
                <option value="false">{tc.no}</option>
                <option value="true">{tc.yes}</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Button type="submit">{tt.save}</Button>
            </div>
          </div>
        </ServerActionForm>
      </Card>

      <Card className="overflow-hidden p-0">
        {types.length === 0 ? (
          <div className="p-4">
            <EmptyState title={tt.empty} />
          </div>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tt.colCode}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tt.colName}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tt.colEntitlement}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tt.colPaid}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tt.colActive}</th>
                </tr>
              </thead>
              <tbody>
                {types.map((ty) => (
                  <tr key={ty.id} className="border-t border-line">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{ty.code}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{pickLocalized(locale, ty.name_ar, ty.name_en)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{ty.annual_entitlement_days}</td>
                    <td className="px-4 py-2.5">{ty.is_paid ? tc.yes : tc.no}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={ty.is_active ? "success" : "neutral"}>{ty.is_active ? tc.yes : tc.no}</Badge>
                    </td>
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
