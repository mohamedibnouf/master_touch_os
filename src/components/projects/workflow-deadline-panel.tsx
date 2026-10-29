import { Button, Field, Input } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { updateWorkflowStepDeadlineAction } from "@/server/use-cases/platform";
import { formatRiyadhDateTimeAr, utcIsoToRiyadhLocalInput } from "@/modules/projects/deadline";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export async function WorkflowDeadlinePanel({
  node,
  projectId,
}: {
  node: WorkflowViewNode;
  projectId: string;
}) {
  if (!node.dueAt && !node.canEditDeadline) return null;
  const { t, locale } = await getI18n();
  const copy = t.projectWorkflow.deadline;
  const dueLabel = node.dueAt ? formatRiyadhDateTimeAr(node.dueAt, locale) : t.projectWorkflow.common.notSet;
  return (
    <div className="space-y-3 rounded-[var(--radius-surface)] border border-line bg-surface px-4 py-3" data-testid="workflow-deadline-panel">
      <div>
        <p className="text-xs text-muted">{copy.title}</p>
        <p className="font-semibold tabular-nums text-ink">{dueLabel}</p>
      </div>
      {node.deadlineState === "ON_TRACK" && node.remainingLabel ? (
        <p className="text-sm text-muted">{format(copy.remaining, { time: node.remainingLabel })}</p>
      ) : null}
      {node.deadlineState === "DUE_SOON" ? (
        <p className="text-sm text-warning">
          {node.remainingLabel ? format(copy.dueSoonRemaining, { time: node.remainingLabel }) : copy.dueSoon}
        </p>
      ) : null}
      {node.deadlineState === "OVERDUE" ? (
        <p className="text-sm text-danger">
          {node.overdueSinceLabel ? format(copy.overdueSince, { time: node.overdueSinceLabel }) : copy.overdue}
        </p>
      ) : null}
      {node.deadlineState === "COMPLETED" ? <p className="text-sm text-muted">{copy.completed}</p> : null}
      {node.canEditDeadline && node.instanceStepId ? (
        <ServerActionForm action={updateWorkflowStepDeadlineAction} className="space-y-3 border-t border-line pt-3">
          <input type="hidden" name="instanceStepId" value={node.instanceStepId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Field label={copy.edit}>
            <Input
              type="datetime-local"
              name="dueAtLocal"
              required
              defaultValue={node.dueAt ? utcIsoToRiyadhLocalInput(node.dueAt) : ""}
            />
          </Field>
          <Button type="submit" variant="secondary">
            {copy.save}
          </Button>
        </ServerActionForm>
      ) : null}
    </div>
  );
}
