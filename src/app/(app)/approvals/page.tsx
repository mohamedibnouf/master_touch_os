import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isEntityApprovalTypeSupported } from "@/lib/approvals/entity-approval-types";
import { decideApprovalAction } from "@/server/use-cases/platform";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";

type ApprovalRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  entity_type: string;
  approval_steps: Array<{
    id: string;
    sequence: number;
    status: string;
    user_id: string | null;
    due_at: string | null;
    decision: string | null;
  }> | null;
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ overdue?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "approval.review") && !hasPermission(ctx, "approval.approve")) {
    redirect("/");
  }

  const { overdue } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const rows = (await repo.listApprovals(ctx.organization.id)) as ApprovalRow[];
  const nowIso = new Date().toISOString();
  const filtered = overdue
    ? rows.filter(
        (row) =>
          row.due_at &&
          row.due_at < nowIso &&
          ["pending", "in_progress"].includes(row.status),
      )
    : rows;

  const canDecide = hasPermission(ctx, "approval.approve") || hasPermission(ctx, "approval.reject");

  return (
    <div data-testid="approvals-page">
      <PageHeader
        title="الموافقات"
        description="طلبات الاعتماد الرسمية برموز القرار A–E"
        actions={
          <Link href={overdue ? "/approvals" : "/approvals?overdue=1"} className="text-sm text-navy underline">
            {overdue ? "عرض الكل" : "المتأخرة فقط"}
          </Link>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد طلبات موافقة حالياً." />
      ) : (
        <div className="space-y-4">
          {filtered.map((request) => {
            const steps = [...(request.approval_steps ?? [])].sort((a, b) => a.sequence - b.sequence);
            const myStep = steps.find(
              (step) =>
                step.user_id === ctx.userId &&
                (step.status === "pending" || step.status === "in_progress"),
            );
            const isOverdue = Boolean(request.due_at && request.due_at < nowIso);

            const formAction = isEntityApprovalTypeSupported(request.entity_type)
              ? decideEntityApprovalAction
              : decideApprovalAction;

            return (
              <Card key={request.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-navy">{request.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {request.entity_type} · {request.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={isOverdue ? "danger" : "navy"}>{isOverdue ? "متأخر" : request.status}</Badge>
                    {request.due_at ? (
                      <Badge>
                        الاستحقاق:{" "}
                        {new Date(request.due_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <ul className="mt-4 space-y-2 border-t border-line pt-4">
                  {steps.map((step) => (
                    <li key={step.id} className="flex items-center justify-between text-sm">
                      <span>
                        خطوة {step.sequence} · {step.status}
                        {step.decision ? ` · ${step.decision}` : ""}
                      </span>
                      {step.user_id === ctx.userId ? <Badge tone="navy">مسندة إليك</Badge> : null}
                    </li>
                  ))}
                </ul>

                {canDecide && myStep ? (
                  <form action={formAction} className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-3">
                    <input type="hidden" name="approvalRequestId" value={request.id} />
                    <input type="hidden" name="stepId" value={myStep.id} />
                    <Field label="رمز القرار">
                      <Select name="officialCode" required defaultValue="A">
                        <option value="A">A — معتمد</option>
                        <option value="B">B — معتمد بملاحظات</option>
                        <option value="C">C — إعادة تقديم</option>
                        <option value="D">D — مرفوض</option>
                        <option value="E">E — للعلم</option>
                      </Select>
                    </Field>
                    <Field label="تعليق">
                      <Textarea name="comment" placeholder="اختياري" />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit">تسجيل القرار</Button>
                    </div>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
