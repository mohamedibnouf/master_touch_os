import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, PageHeader, Section, Textarea } from "@/components/ui/primitives";
import { isUuid } from "@/lib/utils";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";
import { leaveRequestTone } from "@/lib/ui/operational-labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { cancelLeaveRequestAction, decideLeaveRequestAction } from "@/server/use-cases/leave";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

type ProfileName = { full_name_ar?: string | null; full_name_en?: string | null };

export default async function LeaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const req = await repo.getRequest(ctx.organization.id, id);
  if (!req) notFound();

  const [{ data: type }, { data: emp }, { t, locale }] = await Promise.all([
    supabase.from("leave_types").select("name_ar, name_en").eq("id", req.leave_type_id).maybeSingle(),
    supabase
      .from("employees")
      .select("profile_id, job_title_ar, profiles(full_name_ar, full_name_en)")
      .eq("id", req.employee_id)
      .maybeSingle(),
    getI18n(),
  ]);
  const td = t.leave.detail;
  const tc = t.leave.common;

  const isSelf = ctx.employee?.id === req.employee_id;
  // Segregation of duties: nobody decides their own request (mirrors decide_leave_request in 089).
  const isRequester = isSelf || (Boolean(emp?.profile_id) && emp?.profile_id === ctx.profile?.id);
  const isDirectManager =
    Boolean(ctx.profile?.id) &&
    req.manager_profile_id === ctx.profile.id &&
    hasPermission(ctx, "leave.approve_manager");
  const canCancel =
    (isSelf && hasPermission(ctx, "leave.cancel_self") && ["draft", "submitted"].includes(req.status)) ||
    (hasPermission(ctx, "leave.manage") && ["submitted", "approved"].includes(req.status));
  const canDecideManager =
    !isRequester && req.status === "submitted" && req.approval_stage === "manager" && isDirectManager;
  const canDecideHr =
    !isRequester && req.status === "submitted" && req.approval_stage === "hr" && hasPermission(ctx, "leave.manage");
  const showSelfDecisionNote =
    isRequester &&
    req.status === "submitted" &&
    (hasPermission(ctx, "leave.manage") || hasPermission(ctx, "leave.approve_manager"));

  const profileRaw = emp?.profiles as ProfileName | ProfileName[] | null | undefined;
  const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
  const name = profile ? pickLocalized(locale, profile.full_name_ar, profile.full_name_en) : "";
  const typeName = type ? pickLocalized(locale, type.name_ar, type.name_en) : "";
  const stageLabel =
    req.approval_stage in td.stages ? td.stages[req.approval_stage as keyof typeof td.stages] : req.approval_stage;

  return (
    <PageContainer className="mx-auto max-w-2xl space-y-5" data-testid="leave-detail">
      <PageHeader
        title={td.title}
        description={typeName || tc.leave}
        actions={
          <Link href="/leave">
            <Button variant="secondary">{tc.back}</Button>
          </Link>
        }
      />
      <Card>
        <dl className="divide-y divide-line text-sm">
          <div className="flex justify-between gap-3 pb-2.5">
            <dt className="text-muted">{td.employee}</dt>
            <dd className="font-medium text-ink">{name || req.employee_id}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">{td.period}</dt>
            <dd className="text-end tabular-nums text-ink">
              {format(tc.dateRange, { start: req.start_date, end: req.end_date })}
              <span className="ms-2 text-muted">({format(tc.daysCount, { days: req.total_days })})</span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">{td.status}</dt>
            <dd>
              <Badge tone={leaveRequestTone(req.status)} data-testid="leave-status">
                {leaveStatusLabel(req.status, locale)}
              </Badge>
            </dd>
          </div>
          <div className={`flex justify-between gap-3 ${req.reason ? "py-2.5" : "pt-2.5"}`}>
            <dt className="text-muted">{td.approvalStage}</dt>
            <dd className="text-ink">{stageLabel}</dd>
          </div>
          {req.reason ? (
            <div className="pt-2.5">
              <dt className="text-muted">{td.reason}</dt>
              <dd className="mt-1 whitespace-pre-line text-ink">{req.reason}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {canDecideManager || canDecideHr ? (
        <Section title={td.decisionTitle}>
          <ServerActionForm action={decideLeaveRequestAction}>
            <div className="grid gap-3">
              <input type="hidden" name="requestId" value={req.id} />
              <Field label={td.comment}>
                <Textarea name="comment" />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" name="decision" value="approved" data-testid="leave-approve">
                  {td.approve}
                </Button>
                <Button type="submit" name="decision" value="rejected" variant="danger" data-testid="leave-reject">
                  {td.reject}
                </Button>
              </div>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {showSelfDecisionNote ? (
        <p className="text-sm text-muted" data-testid="leave-self-decision-note">
          {td.selfDecisionBlocked}
        </p>
      ) : null}

      {canCancel ? (
        <Card>
          <ServerActionForm action={cancelLeaveRequestAction}>
            <input type="hidden" name="requestId" value={req.id} />
            <Button type="submit" variant="secondary" data-testid="leave-cancel">
              {td.cancel}
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}
    </PageContainer>
  );
}
