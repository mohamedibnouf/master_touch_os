import { Button, Field, Textarea } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { decideApprovalAction } from "@/server/use-cases/platform";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

export function ApprovalActionPanel({
  node,
  projectId,
}: {
  node: WorkflowViewNode;
  projectId: string;
}) {
  if (!node.canDecideApproval || !node.openApproval) return null;
  return (
    <div data-testid="approval-action-panel" className="space-y-3">
      <p className="text-sm text-muted">
        بعد اعتماد A أو B ينتقل المشروع تلقائياً إلى المرحلة التالية. الرمز E يغلق الطلب دون تحريك المسار.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["A", "A — معتمد. تكتمل المرحلة وينتقل المسار.", "success"],
            ["B", "B — معتمد بملاحظات. تكتمل المرحلة وينتقل المسار.", "primary"],
            ["C", "C — إعادة تقديم. يعود المسار لمرحلة التعديل.", "warning"],
            ["D", "D — مرفوض. يُلغى أو يُحوّل حسب إعداد المرحلة.", "danger"],
            ["E", "E — للعلم. يُغلق طلب الاعتماد دون تحريك المسار.", "secondary"],
          ] as const
        ).map(([code, label, variant]) => (
          <ServerActionForm key={code} action={decideApprovalAction} className={code === "A" || code === "B" ? "sm:col-span-2" : undefined}>
            <input type="hidden" name="stepId" value={node.openApproval!.stepId} />
            <input type="hidden" name="officialCode" value={code} />
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="ملاحظة">
              <Textarea name="comment" rows={2} placeholder={code === "A" ? "اختياري" : "سبب القرار"} />
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
