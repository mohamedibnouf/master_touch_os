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
        بعد الموافقة سينتقل المشروع تلقائياً إلى المرحلة التالية. لا تحتاج صلاحية مسار عمل منفصلة لإكمال البوابة.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["A", "موافقة", "primary"],
            ["C", "طلب تعديل", "secondary"],
            ["D", "رفض", "danger"],
          ] as const
        ).map(([code, label, variant]) => (
          <ServerActionForm key={code} action={decideApprovalAction}>
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
