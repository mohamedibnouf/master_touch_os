import { Button, Field, Input } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { updateWorkflowStepDeadlineAction } from "@/server/use-cases/platform";
import { formatRiyadhDateTimeAr, utcIsoToRiyadhLocalInput } from "@/modules/projects/deadline";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

export function WorkflowDeadlinePanel({
  node,
  projectId,
}: {
  node: WorkflowViewNode;
  projectId: string;
}) {
  if (!node.dueAt && !node.canEditDeadline) return null;
  const dueLabel = node.dueAt ? formatRiyadhDateTimeAr(node.dueAt) : "غير محدد";
  return (
    <div className="space-y-3 rounded-[var(--radius-surface)] border border-line bg-white px-4 py-3" data-testid="workflow-deadline-panel">
      <div>
        <p className="text-xs text-muted">موعد إغلاق المرحلة</p>
        <p className="font-semibold text-ink">{dueLabel}</p>
      </div>
      {node.deadlineState === "ON_TRACK" && node.remainingLabel ? (
        <p className="text-sm text-muted">متبقي {node.remainingLabel}</p>
      ) : null}
      {node.deadlineState === "DUE_SOON" ? (
        <p className="text-sm text-warning">اقترب موعد انتهاء المرحلة{node.remainingLabel ? ` — متبقي ${node.remainingLabel}` : ""}</p>
      ) : null}
      {node.deadlineState === "OVERDUE" ? (
        <p className="text-sm text-danger">المرحلة متأخرة{node.overdueSinceLabel ? ` منذ ${node.overdueSinceLabel}` : ""}</p>
      ) : null}
      {node.deadlineState === "COMPLETED" ? <p className="text-sm text-muted">اكتملت المرحلة. لا تُرسل تنبيهات لاحقة.</p> : null}
      {node.canEditDeadline && node.instanceStepId ? (
        <ServerActionForm action={updateWorkflowStepDeadlineAction} className="space-y-3">
          <input type="hidden" name="instanceStepId" value={node.instanceStepId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="تعديل الموعد">
            <Input
              type="datetime-local"
              name="dueAtLocal"
              required
              defaultValue={node.dueAt ? utcIsoToRiyadhLocalInput(node.dueAt) : ""}
            />
          </Field>
          <Button type="submit" variant="secondary">
            حفظ الموعد
          </Button>
        </ServerActionForm>
      ) : null}
    </div>
  );
}
