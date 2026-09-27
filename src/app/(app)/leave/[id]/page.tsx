import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, PageHeader, Textarea } from "@/components/ui/primitives";
import { isUuid } from "@/lib/utils";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LeaveRepository } from "@/server/repositories/leave.repository";
import { leaveStatusLabel } from "@/lib/hr/labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { cancelLeaveRequestAction, decideLeaveRequestAction } from "@/server/use-cases/leave";

export default async function LeaveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const repo = new LeaveRepository(supabase);
  const req = await repo.getRequest(ctx.organization.id, id);
  if (!req) notFound();

  const [{ data: type }, { data: emp }] = await Promise.all([
    supabase.from("leave_types").select("name_ar, name_en").eq("id", req.leave_type_id).maybeSingle(),
    supabase
      .from("employees")
      .select("profile_id, job_title_ar, profiles(full_name_ar)")
      .eq("id", req.employee_id)
      .maybeSingle(),
  ]);

  const isSelf = ctx.employee?.id === req.employee_id;
  const isDirectManager =
    Boolean(ctx.profile?.id) &&
    req.manager_profile_id === ctx.profile.id &&
    hasPermission(ctx, "leave.approve_manager");
  const canCancel =
    (isSelf && hasPermission(ctx, "leave.cancel_self") && ["draft", "submitted"].includes(req.status)) ||
    (hasPermission(ctx, "leave.manage") && ["submitted", "approved"].includes(req.status));
  const canDecideManager =
    req.status === "submitted" && req.approval_stage === "manager" && isDirectManager;
  const canDecideHr =
    req.status === "submitted" && req.approval_stage === "hr" && hasPermission(ctx, "leave.manage");

  const profile = emp?.profiles;
  const name = Array.isArray(profile)
    ? profile[0]?.full_name_ar
    : profile && typeof profile === "object" && "full_name_ar" in profile
      ? (profile as { full_name_ar?: string }).full_name_ar
      : undefined;

  return (
    <div className="mx-auto max-w-2xl" data-testid="leave-detail">
      <PageHeader
        title="تفاصيل طلب الإجازة"
        description={type?.name_ar ?? "إجازة"}
        actions={
          <Link href="/leave">
            <Button variant="secondary">رجوع</Button>
          </Link>
        }
      />
      <Card className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">الموظف</span>
          <span>{name ?? req.employee_id}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">الفترة</span>
          <span>
            {req.start_date} → {req.end_date} ({req.total_days} يوم)
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">الحالة</span>
          <Badge data-testid="leave-status">{leaveStatusLabel(req.status)}</Badge>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">مرحلة الاعتماد</span>
          <span>{req.approval_stage}</span>
        </div>
        {req.reason ? (
          <div>
            <p className="text-muted">السبب</p>
            <p className="mt-1">{req.reason}</p>
          </div>
        ) : null}
      </Card>

      {canDecideManager || canDecideHr ? (
        <Card className="mb-4">
          <h2 className="mb-3 font-semibold text-navy">اتخاذ قرار</h2>
          <ServerActionForm action={decideLeaveRequestAction} className="grid gap-3">
            <input type="hidden" name="requestId" value={req.id} />
            <Field label="ملاحظة">
              <Textarea name="comment" />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" name="decision" value="approved" data-testid="leave-approve">
                اعتماد
              </Button>
              <Button type="submit" name="decision" value="rejected" variant="danger" data-testid="leave-reject">
                رفض
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {canCancel ? (
        <Card>
          <ServerActionForm action={cancelLeaveRequestAction}>
            <input type="hidden" name="requestId" value={req.id} />
            <Button type="submit" variant="secondary" data-testid="leave-cancel">
              إلغاء الطلب
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}
    </div>
  );
}
