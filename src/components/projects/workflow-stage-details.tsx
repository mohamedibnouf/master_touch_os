import { Badge, Button, Field, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { ApprovalActionPanel } from "@/components/projects/approval-action-panel";
import { WorkflowDeadlinePanel } from "@/components/projects/workflow-deadline-panel";
import {
  completeProjectStageAction,
  completeWorkflowStepAction,
  createApprovalAction,
} from "@/server/use-cases/platform";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

function formatStamp(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export function WorkflowStageDetails({
  node,
  projectId,
  projectCode,
  approvers,
}: {
  node: WorkflowViewNode;
  projectId: string;
  projectCode: string;
  approvers: Array<{ id: string; name: string }>;
}) {
  return (
    <div data-testid="workflow-stage-details" className="space-y-4">
      <div>
        <p className="text-xs text-muted">تفاصيل المرحلة</p>
        <h2 className="text-lg font-semibold text-ink">{node.nameAr}</h2>
        <p className="text-sm text-muted">{node.nameEn}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge
          tone={
            node.visual === "completed"
              ? "success"
              : node.visual === "waiting_approval" || node.visual === "changes_requested"
                ? "warning"
                : node.visual === "blocked" || node.visual === "rejected" || node.visual === "overdue"
                  ? "danger"
                  : node.visual === "current"
                    ? "navy"
                    : "neutral"
          }
        >
          {node.visualLabel}
        </Badge>
        <Badge>{node.gate === "APPROVAL" ? "بوابة اعتماد" : "إكمال معتمد"}</Badge>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">المسؤول</dt>
          <dd>{node.responsibleLabel ?? "غير محدد"}</dd>
        </div>
        {node.requiredRoleLabel ? (
          <div>
            <dt className="text-muted">الدور المطلوب</dt>
            <dd>{node.requiredRoleLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted">الموافقة المطلوبة</dt>
          <dd>{node.requiresApproval ? (node.approverLabel ?? "نعم") : "لا"}</dd>
        </div>
        <div>
          <dt className="text-muted">بدأت</dt>
          <dd>{formatStamp(node.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">موعد الإغلاق</dt>
          <dd>{formatStamp(node.dueAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">اكتملت</dt>
          <dd>{formatStamp(node.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">أنجزها</dt>
          <dd>{node.completedByLabel ?? "—"}</dd>
        </div>
      </dl>
      <WorkflowDeadlinePanel node={node} projectId={projectId} />
      {node.blockReason ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-sm">{node.blockReason}</p>
      ) : null}
      {node.requiresApproval && !node.openApproval && node.visual !== "completed" ? (
        <p className="text-sm text-muted">هذه مرحلة بوابة اعتماد. لا يمكن إكمالها يدوياً قبل قرار المعتمد.</p>
      ) : null}
      {node.activationHint ? (
        <p className="text-sm text-navy" data-testid="workflow-auto-advance-hint">
          {node.activationHint}
        </p>
      ) : null}
      {node.latestOfficialCode === "C" ? <p className="text-sm text-warning">تم طلب تعديل. العمل السابق محفوظ.</p> : null}
      {node.latestOfficialCode === "D" ? <p className="text-sm text-danger">تم الرفض.</p> : null}

      <ApprovalActionPanel node={node} projectId={projectId} />

      {node.canSubmitApproval && node.instanceStepId ? (
        <ServerActionForm action={createApprovalAction} className="space-y-3">
          <input type="hidden" name="entityType" value="workflow_instance_step" />
          <input type="hidden" name="entityId" value={node.instanceStepId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="title" value={`اعتماد مرحلة ${node.nameAr} — ${projectCode}`} />
          <Field label="المعتمد">
            <Select name="approverProfileId" required>
              {approvers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">إرسال للاعتماد</Button>
        </ServerActionForm>
      ) : null}

      {node.canComplete && node.instanceStepId ? (
        <ServerActionForm action={completeWorkflowStepAction}>
          <input type="hidden" name="instanceStepId" value={node.instanceStepId} />
          <input type="hidden" name="outcome" value="complete" />
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" variant="success">
            إكمال المرحلة
          </Button>
        </ServerActionForm>
      ) : null}

      {node.canComplete && node.projectStageId ? (
        <ServerActionForm action={completeProjectStageAction}>
          <input type="hidden" name="stageId" value={node.projectStageId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" variant="success">
            إكمال المرحلة
          </Button>
        </ServerActionForm>
      ) : null}
    </div>
  );
}
