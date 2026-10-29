import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { LeaveRequestForm } from "@/components/leave/leave-request-form";
import type { LeaveDayBasis } from "@/lib/leave/days";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewLeavePage() {
  const ctx = authorize(await getAuthContext(), "leave.request");
  if (!ctx.employee) redirect("/leave");

  const year = new Date().getFullYear();
  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const [types, balances, { t, locale }] = await Promise.all([
    repo.listLeaveTypes(ctx.organization.id, true),
    repo.listBalances(ctx.organization.id, ctx.employee.id, year),
    getI18n(),
  ]);
  const tn = t.leave.newRequest;

  const dayBasis = (ctx.organization.leave_day_basis ?? "calendar") as LeaveDayBasis;

  return (
    <PageContainer className="mx-auto max-w-2xl">
      <PageHeader title={tn.title} description={tn.description} />
      <Card>
        {types.length === 0 ? (
          <p className="text-sm text-muted">{tn.noTypes}</p>
        ) : (
          <LeaveRequestForm
            types={types.map((ty) => ({
              id: ty.id,
              name: pickLocalized(locale, ty.name_ar, ty.name_en),
              requires_attachment: ty.requires_attachment,
              minimum_notice_days: ty.minimum_notice_days,
              allow_negative_balance: ty.allow_negative_balance,
            }))}
            balances={balances.map((b) => ({
              leave_type_id: b.leave_type_id,
              available_days: Number(b.available_days),
            }))}
            dayBasis={dayBasis}
          />
        )}
      </Card>
    </PageContainer>
  );
}
