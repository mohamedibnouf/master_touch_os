import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isEntityApprovalTypeSupported } from "@/lib/approvals/entity-approval-types";
import { approvalStatusLabel, approvalStepStatusLabel } from "@/lib/ui/operational-labels";
import { auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { decideApprovalAction } from "@/server/use-cases/platform";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, intlLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

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
    decision?: string | null;
  }> | null;
};

const DECISION_CODES = ["A", "B", "C", "D", "E"] as const;

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

  const { t, locale } = await getI18n();
  const ta = t.workspace.approvals;
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
    <PageContainer data-testid="approvals-page" className="space-y-5">
      <PageHeader
        title={ta.title}
        description={ta.description}
        actions={
          <Link
            href={overdue ? "/approvals" : "/approvals?overdue=1"}
            className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            {overdue ? ta.showAll : ta.overdueOnly}
          </Link>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState title={ta.empty} />
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
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{request.title}</h2>
                    <p className="mt-1 text-xs text-muted">
                      {auditEntityLabel(request.entity_type, locale)} · {approvalStatusLabel(request.status, locale)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={isOverdue ? "danger" : "navy"}>
                      {isOverdue ? ta.overdue : approvalStatusLabel(request.status, locale)}
                    </Badge>
                    {request.due_at ? (
                      <Badge>
                        {format(ta.due, {
                          date: new Date(request.due_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" }),
                        })}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <ul className="mt-4 space-y-2 border-t border-line pt-4">
                  {steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm text-ink"
                    >
                      <span>
                        {format(ta.step, { sequence: step.sequence })} · {approvalStepStatusLabel(step.status, locale)}
                        {step.decision ? ` · ${step.decision}` : ""}
                      </span>
                      {step.user_id === ctx.userId ? <Badge tone="navy">{ta.assignedToYou}</Badge> : null}
                    </li>
                  ))}
                </ul>

                {canDecide && myStep ? (
                  <ServerActionForm action={formAction} className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-3">
                    <input type="hidden" name="approvalRequestId" value={request.id} />
                    <input type="hidden" name="stepId" value={myStep.id} />
                    <Field label={ta.decisionCode}>
                      <Select name="officialCode" required defaultValue="A">
                        {DECISION_CODES.map((code) => (
                          <option key={code} value={code}>
                            {ta.codes[code]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={ta.comment}>
                      <Textarea name="comment" placeholder={ta.optional} />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit">{ta.submit}</Button>
                    </div>
                  </ServerActionForm>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
