import { Button, Field, Textarea } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { decideApprovalAction } from "@/server/use-cases/platform";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";
import { getI18n } from "@/lib/i18n/server";

export async function ApprovalActionPanel({
  node,
  projectId,
}: {
  node: WorkflowViewNode;
  projectId: string;
}) {
  if (!node.canDecideApproval || !node.openApproval) return null;
  const { t } = await getI18n();
  const copy = t.projectWorkflow.approvalPanel;
  return (
    <div data-testid="approval-action-panel" className="space-y-3">
      <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm leading-6 text-muted">{copy.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["A", copy.codeA, "success"],
            ["B", copy.codeB, "primary"],
            ["C", copy.codeC, "warning"],
            ["D", copy.codeD, "danger"],
            ["E", copy.codeE, "secondary"],
          ] as const
        ).map(([code, label, variant]) => (
          <ServerActionForm
            key={code}
            action={decideApprovalAction}
            className={
              code === "A" || code === "B"
                ? "rounded-[var(--radius-control)] border border-line p-3 sm:col-span-2"
                : "rounded-[var(--radius-control)] border border-line p-3"
            }
          >
            <input type="hidden" name="stepId" value={node.openApproval!.stepId} />
            <input type="hidden" name="officialCode" value={code} />
            <input type="hidden" name="projectId" value={projectId} />
            <Field label={t.projectWorkflow.common.note}>
              <Textarea name="comment" rows={2} placeholder={code === "A" ? copy.optional : copy.decisionReason} />
            </Field>
            <Button type="submit" variant={variant} className="mt-2 w-full">
              {label}
            </Button>
          </ServerActionForm>
        ))}
      </div>
    </div>
  );
}
