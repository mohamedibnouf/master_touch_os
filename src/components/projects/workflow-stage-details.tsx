import { Badge, Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { ApprovalActionPanel } from "@/components/projects/approval-action-panel";
import { WorkflowDeadlinePanel } from "@/components/projects/workflow-deadline-panel";
import {
  completeProjectStageAction,
  completeWorkflowStepAction,
} from "@/server/use-cases/platform";
import { WorkflowGateSubmitFields, type GateSupportingDocumentOption } from "@/components/projects/workflow-gate-approval-card";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";
import { ProcurementReadinessCard } from "@/components/projects/procurement-readiness-card";
import { MobilizationReadinessCard } from "@/components/projects/mobilization-readiness-card";
import { ExecutionProgressCard } from "@/components/projects/execution-progress-card";
import { CommissioningProgressCard } from "@/components/projects/commissioning-progress-card";
import { HandoverReadinessCard } from "@/components/projects/handover-readiness-card";
import { PROCUREMENT_STEP_KEY, type ProjectProcurementReadiness } from "@/modules/procurement/stage05-readiness";
import { MOBILIZATION_STEP_KEY, type ProjectMobilizationReadiness } from "@/modules/projects/stage06-mobilization";
import { EXECUTION_STEP_KEY, type ProjectExecutionProgress } from "@/modules/projects/stage07-execution";
import { COMMISSIONING_STEP_KEY, type ProjectCommissioningProgress } from "@/modules/projects/stage08-commissioning";
import { HANDOVER_STEP_KEY, type ProjectHandoverReadiness } from "@/modules/projects/stage09-handover";
import { intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function formatStamp(value: string | null, locale: Locale): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

export async function WorkflowStageDetails({
  node,
  projectId,
  projectCode,
  approvers,
  documents,
  procurementReadiness = null,
  canOpenProcurement = false,
  canCreatePr = false,
  mobilizationReadiness = null,
  executionProgress = null,
  commissioningProgress = null,
  handoverReadiness = null,
}: {
  node: WorkflowViewNode;
  projectId: string;
  projectCode: string;
  approvers: Array<{ id: string; name: string }>;
  documents: GateSupportingDocumentOption[];
  procurementReadiness?: ProjectProcurementReadiness | null;
  canOpenProcurement?: boolean;
  canCreatePr?: boolean;
  mobilizationReadiness?: ProjectMobilizationReadiness | null;
  executionProgress?: ProjectExecutionProgress | null;
  commissioningProgress?: ProjectCommissioningProgress | null;
  handoverReadiness?: ProjectHandoverReadiness | null;
}) {
  const { t, locale } = await getI18n();
  const copy = t.projectWorkflow.details;
  const common = t.projectWorkflow.common;
  const name = pickLocalized(locale, node.nameAr, node.nameEn);
  const secondaryName = locale === "en" ? node.nameAr : node.nameEn;
  return (
    <div data-testid="workflow-stage-details" className="space-y-4">
      <div>
        <p className="text-xs text-muted">{copy.eyebrow}</p>
        <h2 className="text-lg font-semibold text-ink" dir="auto">
          {name}
        </h2>
        {secondaryName && secondaryName !== name ? (
          <p className="text-sm text-muted" dir="auto">
            {secondaryName}
          </p>
        ) : null}
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
        <Badge>{node.gate === "APPROVAL" ? copy.approvalGate : copy.approvedCompletion}</Badge>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{common.owner}</dt>
          <dd>{node.responsibleLabel ?? common.notSet}</dd>
        </div>
        {node.requiredRoleLabel ? (
          <div>
            <dt className="text-muted">{common.requiredRole}</dt>
            <dd>{node.requiredRoleLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted">{copy.approvalRequired}</dt>
          <dd>{node.requiresApproval ? (node.approverLabel ?? copy.yes) : copy.no}</dd>
        </div>
        <div>
          <dt className="text-muted">{copy.started}</dt>
          <dd className="tabular-nums">{formatStamp(node.startedAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{copy.dueAt}</dt>
          <dd className="tabular-nums">{formatStamp(node.dueAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{copy.completed}</dt>
          <dd className="tabular-nums">{formatStamp(node.completedAt, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{copy.completedBy}</dt>
          <dd>{node.completedByLabel ?? "—"}</dd>
        </div>
      </dl>
      <WorkflowDeadlinePanel node={node} projectId={projectId} />
      {node.blockReason ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-ink">{node.blockReason}</p>
      ) : null}
      {node.requiresApproval && !node.openApproval && node.visual !== "completed" ? (
        <p className="text-sm text-muted">{copy.gateHint}</p>
      ) : null}
      {node.activationHint ? (
        <p className="text-sm text-primary" data-testid="workflow-auto-advance-hint">
          {node.activationHint}
        </p>
      ) : null}
      {node.latestOfficialCode === "C" ? <p className="text-sm text-warning">{copy.changesRequested}</p> : null}
      {node.latestOfficialCode === "D" ? <p className="text-sm text-danger">{copy.rejected}</p> : null}

      <ApprovalActionPanel node={node} projectId={projectId} />

      {node.stepKey === PROCUREMENT_STEP_KEY && procurementReadiness ? (
        <ProcurementReadinessCard
          readiness={procurementReadiness}
          projectId={projectId}
          canOpenProcurement={canOpenProcurement}
          canCreatePr={canCreatePr}
        />
      ) : null}

      {node.stepKey === MOBILIZATION_STEP_KEY && mobilizationReadiness ? (
        <MobilizationReadinessCard
          readiness={mobilizationReadiness}
          projectId={projectId}
          canMutate={node.canComplete}
          canOpenProcurement={canOpenProcurement}
        />
      ) : null}

      {node.stepKey === EXECUTION_STEP_KEY && executionProgress ? (
        <ExecutionProgressCard
          progress={executionProgress}
          projectId={projectId}
          canMutate={node.canComplete}
        />
      ) : null}

      {node.stepKey === COMMISSIONING_STEP_KEY && commissioningProgress ? (
        <CommissioningProgressCard
          progress={commissioningProgress}
          projectId={projectId}
          canMutate={node.canComplete}
        />
      ) : null}

      {node.stepKey === HANDOVER_STEP_KEY && handoverReadiness ? (
        <HandoverReadinessCard
          readiness={handoverReadiness}
          projectId={projectId}
          canMutate={node.canComplete}
        />
      ) : null}

      {node.canSubmitApproval ? (
        <WorkflowGateSubmitFields
          projectId={projectId}
          projectCode={projectCode}
          stageNameAr={node.nameAr}
          stageNameEn={node.nameEn}
          approvers={approvers}
          documents={documents}
        />
      ) : null}

      {node.canComplete && node.instanceStepId ? (
        <ServerActionForm action={completeWorkflowStepAction}>
          <input type="hidden" name="instanceStepId" value={node.instanceStepId} />
          <input type="hidden" name="outcome" value="complete" />
          <input type="hidden" name="projectId" value={projectId} />
          <Button
            type="submit"
            variant="success"
            disabled={
              (node.stepKey === PROCUREMENT_STEP_KEY && procurementReadiness?.ready === false) ||
              (node.stepKey === MOBILIZATION_STEP_KEY && mobilizationReadiness?.ready === false) ||
              (node.stepKey === EXECUTION_STEP_KEY && executionProgress?.ready === false) ||
              (node.stepKey === COMMISSIONING_STEP_KEY && commissioningProgress?.ready === false) ||
              (node.stepKey === HANDOVER_STEP_KEY && handoverReadiness?.ready === false)
            }
          >
            {common.completeStage}
          </Button>
        </ServerActionForm>
      ) : null}

      {node.canComplete && node.projectStageId ? (
        <ServerActionForm action={completeProjectStageAction}>
          <input type="hidden" name="stageId" value={node.projectStageId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" variant="success">
            {common.completeStage}
          </Button>
        </ServerActionForm>
      ) : null}
    </div>
  );
}
