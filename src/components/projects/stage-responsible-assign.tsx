"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { assignWorkflowStepResponsibleAction } from "@/server/use-cases/platform";
import { responsibleCandidateOptionLabel } from "@/modules/projects/workflow-responsibility";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

export type ResponsibleCandidate = {
  id: string;
  name: string;
  projectRole: string | null;
  jobTitle: string | null;
};

export function StageResponsibleAssign({
  node,
  projectId,
  candidates,
}: {
  node: WorkflowViewNode;
  projectId: string;
  candidates: ResponsibleCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const onSaved = useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);
  if (!node.canAssignResponsible || !node.workflowStepId) return null;

  return (
    <div className="mt-2 min-w-0 sm:text-end" data-testid="stage-responsible-assign">
      <Button type="button" variant="outline" className="min-h-9 px-3 text-xs" onClick={() => setOpen((v) => !v)}>
        {node.responsibleUserId ? "تغيير" : "تعيين مسؤول"}
      </Button>
      {open ? (
        <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-white p-3 text-start shadow-sm">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted">لا يوجد أعضاء نشطون في فريق المشروع.</p>
          ) : (
            <ServerActionForm action={assignWorkflowStepResponsibleAction} className="space-y-2" onSuccess={onSaved}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="workflowStepId" value={node.workflowStepId} />
              <Field label="المسؤول">
                <Select name="responsibleUserId" required defaultValue={node.responsibleUserId ?? candidates[0]?.id}>
                  {candidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {responsibleCandidateOptionLabel(user)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">حفظ</Button>
            </ServerActionForm>
          )}
        </div>
      ) : null}
    </div>
  );
}
