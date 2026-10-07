import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext, ProjectStage } from "@/types/models";
import { hasPermission } from "@/server/policies/authorize";
import {
  blockReasonForNode,
  buildProjectAttention,
  deriveStageProgress,
  deriveWorkflowStepActions,
  formatOverdueDurationAr,
  mapEngineStatusToVisual,
  pickCurrentNodeId,
  indexStepAssignments,
  resolveStageAssignment,
  waitingApprovalPhrase,
  workflowVisualLabel,
  type OfficialApprovalCode,
  type OpenApprovalSnapshot,
  type ProjectAttention,
  type StageAssignmentKind,
  type WorkflowGateKind,
  type WorkflowVisualState,
} from "@/modules/projects/workflow-view";
import {
  deriveDeadlineState,
  formatOverdueSinceAr,
  formatRemainingAr,
  type DeadlineState,
} from "@/modules/projects/deadline";
import {
  WORKFLOW_ASSIGN_PERMISSION,
  canReassignWorkflowStepStatus,
} from "@/modules/projects/workflow-responsibility";
import { resolveWorkflowStepExecutionLookup } from "@/modules/projects/workflow-step-execution";
import { logger } from "@/lib/logger";

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type WorkflowViewNode = {
  id: string;
  source: "workflow" | "legacy";
  sequence: number;
  nameAr: string;
  nameEn: string;
  visual: WorkflowVisualState;
  visualLabel: string;
  engineStatus: string;
  gate: WorkflowGateKind;
  requiresApproval: boolean;
  responsibleLabel: string | null;
  assignmentKind: StageAssignmentKind;
  assignmentSubtitle: string | null;
  requiredRoleLabel: string | null;
  requiredDepartmentLabel: string | null;
  approverLabel: string | null;
  startedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  completedByLabel: string | null;
  blockReason: string | null;
  overdueLabel: string | null;
  activationHint: string | null;
  instanceStepId: string | null;
  projectStageId: string | null;
  openApproval: OpenApprovalSnapshot | null;
  latestOfficialCode: OfficialApprovalCode | null;
  canComplete: boolean;
  canSubmitApproval: boolean;
  canDecideApproval: boolean;
  canEditDeadline: boolean;
  warningHours: number | null;
  deadlineState: DeadlineState;
  remainingLabel: string | null;
  overdueSinceLabel: string | null;
  workflowStepId: string | null;
  responsibleUserId: string | null;
  canAssignResponsible: boolean;
  stepKey: string | null;
};

export type ProjectWorkflowProjection = {
  mode: "workflow" | "legacy" | "empty" | "preview";
  instanceId: string | null;
  instanceStatus: string | null;
  definitionName: string | null;
  nodes: WorkflowViewNode[];
  progress: { completed: number; total: number; percent: number };
  currentNodeId: string | null;
  attention: ProjectAttention;
  nextRequiredAction: string;
};

type StepDef = {
  name_ar: string;
  name_en: string;
  requires_approval: boolean;
  assigned_role_id: string | null;
  assigned_department_id: string | null;
  warning_hours: number | null;
  sla_hours: number | null;
};

type InstanceStepRow = {
  id: string;
  sequence: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  assigned_user_id: string | null;
  assigned_role_id: string | null;
  assigned_department_id: string | null;
  responsible_user_id: string | null;
  due_at: string | null;
  step_key: string;
  step_id: string;
  workflow_steps: StepDef | StepDef[] | null;
};

type ApprovalRow = {
  id: string;
  title: string;
  status: string;
  entity_type: string;
  entity_id: string;
  approval_steps: Array<{ id: string; sequence: number; status: string; user_id: string | null }> | null;
};

type ActionRow = {
  step_id: string;
  official_code: string;
  created_at: string;
};

function isOfficialCode(value: string): value is OfficialApprovalCode {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}

export async function loadProjectWorkflowProjection(input: {
  supabase: SupabaseClient;
  ctx: AuthContext;
  projectId: string;
  stages: ProjectStage[];
  profileNames: Map<string, string>;
  roleNames: Map<string, string>;
  departmentNames?: Map<string, string>;
  jobTitles?: Map<string, string>;
}): Promise<ProjectWorkflowProjection> {
  const nowIso = new Date().toISOString();
  const { supabase, ctx, projectId, stages, profileNames, roleNames } = input;
  const departmentNames = input.departmentNames ?? new Map<string, string>();
  const jobTitles = input.jobTitles ?? new Map<string, string>();

  const { data: instance } = await supabase
    .from("workflow_instances")
    .select("id, status, definition_id, started_at, completed_at")
    .eq("organization_id", ctx.organization.id)
    .eq("entity_type", "project")
    .eq("entity_id", projectId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      status: string;
      definition_id: string;
      started_at: string;
      completed_at: string | null;
    }>();

  if (instance) {
    const [{ data: stepRows }, { data: definition }] = await Promise.all([
      supabase
        .from("workflow_instance_steps")
        .select(
          "id, sequence, status, started_at, completed_at, completed_by, assigned_user_id, assigned_role_id, assigned_department_id, responsible_user_id, due_at, step_key, step_id, workflow_steps(name_ar, name_en, requires_approval, assigned_role_id, assigned_department_id, warning_hours, sla_hours)",
        )
        .eq("instance_id", instance.id)
        .order("sequence"),
      supabase.from("workflow_definitions").select("name_ar").eq("id", instance.definition_id).maybeSingle<{ name_ar: string }>(),
    ]);

    const steps = (stepRows ?? []) as InstanceStepRow[];
    const stepIds = steps.map((s) => s.id);

    const { data: approvals } = stepIds.length
      ? await supabase
          .from("approval_requests")
          .select("id, title, status, entity_type, entity_id, approval_steps(id, sequence, status, user_id)")
          .eq("organization_id", ctx.organization.id)
          .eq("entity_type", "workflow_instance_step")
          .in("entity_id", stepIds)
      : { data: [] as ApprovalRow[] };

    const approvalList = (approvals ?? []) as ApprovalRow[];
    const approvalStepIds = approvalList.flatMap((r) => (r.approval_steps ?? []).map((s) => s.id));

    const { data: actions } = approvalStepIds.length
      ? await supabase
          .from("approval_actions")
          .select("step_id, official_code, created_at")
          .in("step_id", approvalStepIds)
          .order("created_at", { ascending: false })
      : { data: [] as ActionRow[] };

    const latestByApprovalStep = new Map<string, OfficialApprovalCode>();
    for (const action of (actions ?? []) as ActionRow[]) {
      if (!latestByApprovalStep.has(action.step_id) && isOfficialCode(action.official_code)) {
        latestByApprovalStep.set(action.step_id, action.official_code);
      }
    }

    const canManage = hasPermission(ctx, "workflow.manage");
    const canAdvance = canManage || hasPermission(ctx, "workflow.advance");
    const canCreateApproval = hasPermission(ctx, "approval.create");
    const canApprove = hasPermission(ctx, "approval.approve") || hasPermission(ctx, "approval.reject");

    const activeEngine = steps.find((s) => s.status === "ready" || s.status === "in_progress");
    let canExecuteActive = false;
    if (activeEngine) {
      const { data: execOk, error: execErr } = await supabase.rpc("can_execute_workflow_instance_step", {
        p_instance_step_id: activeEngine.id,
      });
      const lookup = resolveWorkflowStepExecutionLookup({
        canManage,
        canAdvance,
        executeOk: execOk === true,
        executeError: execErr,
        legacyCanAct: null,
      });
      if (lookup.shouldCallLegacyCanAct) {
        const { data } = await supabase.rpc("can_act_on_workflow_step", {
          p_step_id: activeEngine.id,
        });
        canExecuteActive = data === true;
      } else {
        canExecuteActive = lookup.canExecute;
      }
      if (lookup.failedClosed) {
        logger.warn("workflow execution predicate failed closed", {
          code: execErr && "code" in execErr && typeof execErr.code === "string" ? execErr.code : null,
        });
      }
    }

    const nodes: WorkflowViewNode[] = steps.map((step, index) => {
      const def = asOne(step.workflow_steps);
      const requiresApproval = Boolean(def?.requires_approval);
      const related = approvalList.filter((r) => r.entity_id === step.id);
      const openReq = related.find((r) => r.status === "pending" || r.status === "in_progress") ?? null;
      const openStep = openReq
        ? [...(openReq.approval_steps ?? [])]
            .sort((a, b) => a.sequence - b.sequence)
            .find((s) => s.status === "pending" || s.status === "in_progress") ??
          (openReq.approval_steps ?? [])[0] ??
          null
        : null;
      const openApproval: OpenApprovalSnapshot | null =
        openReq && openStep
          ? {
              requestId: openReq.id,
              stepId: openStep.id,
              status: openReq.status,
              approverUserId: openStep.user_id,
              approverLabel: openStep.user_id ? (profileNames.get(openStep.user_id) ?? null) : null,
            }
          : null;

      let latestOfficialCode: OfficialApprovalCode | null = null;
      for (const req of related) {
        for (const ast of req.approval_steps ?? []) {
          const code = latestByApprovalStep.get(ast.id);
          if (code) latestOfficialCode = code;
        }
      }

      const visual = mapEngineStatusToVisual({
        engineStatus: step.status,
        requiresApproval,
        dueAt: step.due_at,
        nowIso,
        openApproval,
        latestOfficialCode,
      });
      const overdueLabel = step.due_at ? formatOverdueDurationAr(step.due_at, nowIso) : null;
      const roleId = step.assigned_role_id ?? def?.assigned_role_id ?? null;
      const departmentId = step.assigned_department_id ?? def?.assigned_department_id ?? null;
      const assignment = resolveStageAssignment({
        responsibleUserId: step.responsible_user_id,
        assignedUserId: step.assigned_user_id,
        assignedRoleId: roleId,
        assignedDepartmentId: departmentId,
        profileNames,
        roleNames,
        departmentNames,
        jobTitles,
      });
      const responsibleLabel = assignment.kind === "user" ? assignment.label : null;
      const assignmentKind = assignment.kind;
      const assignmentSubtitle = assignment.subtitle;
      const approverLabel = openApproval?.approverLabel ?? (requiresApproval ? responsibleLabel : null);
      const isActive = step.id === activeEngine?.id;
      const actions = deriveWorkflowStepActions({
        isActive,
        canExecuteStep: canExecuteActive,
        canCreateApproval,
        canDecideThisApproval: Boolean(
          canApprove &&
            openApproval &&
            openApproval.approverUserId === ctx.userId &&
            (openStep?.status === "pending" || openStep?.status === "in_progress"),
        ),
        requiresApproval,
        openApproval,
        latestOfficialCode,
      });
      const canDecideApproval = actions.canDecideApproval;
      const canSubmitApproval = actions.canSubmitApproval;
      const canComplete = actions.canComplete;
      const warningHours = def?.warning_hours ?? null;
      const deadlineState = deriveDeadlineState({
        engineStatus: step.status,
        dueAt: step.due_at,
        warningHours,
        nowIso,
      });
      const remainingLabel = step.due_at ? formatRemainingAr(step.due_at, nowIso) : null;
      const overdueSinceLabel = step.due_at ? formatOverdueSinceAr(step.due_at, nowIso) : null;

      const prev = steps[index - 1];
      let activationHint: string | null = null;
      if (isActive && prev && (prev.status === "completed" || prev.status === "skipped")) {
        const prevDef = asOne(prev.workflow_steps);
        activationHint = prevDef?.requires_approval
          ? "تم الانتقال تلقائياً بعد اكتمال الموافقة"
          : "تم الانتقال تلقائياً بعد اكتمال المرحلة السابقة";
      }

      return {
        id: step.id,
        source: "workflow",
        sequence: step.sequence,
        nameAr: def?.name_ar ?? step.step_key,
        nameEn: def?.name_en ?? step.step_key,
        visual,
        visualLabel:
          visual === "waiting_approval" || (visual === "overdue" && openApproval)
            ? `${waitingApprovalPhrase(approverLabel)}${overdueLabel ? ` · ${overdueLabel}` : ""}`
            : workflowVisualLabel(visual),
        engineStatus: step.status,
        gate: requiresApproval ? "APPROVAL" : "MANUAL_COMPLETION",
        requiresApproval,
        responsibleLabel,
        assignmentKind,
        assignmentSubtitle,
        requiredRoleLabel: assignment.requiredRoleLabel,
        requiredDepartmentLabel: assignment.requiredDepartmentLabel,
        approverLabel,
        startedAt: step.started_at,
        dueAt: step.due_at,
        completedAt: step.completed_at,
        completedByLabel: step.completed_by ? (profileNames.get(step.completed_by) ?? null) : null,
        blockReason: blockReasonForNode({
          visual,
          requiresApproval,
          openApproval,
          latestOfficialCode,
          overdueLabel,
          missingAssignee:
            requiresApproval &&
            !openApproval &&
            !responsibleLabel &&
            !assignment.requiredRoleLabel &&
            !assignment.requiredDepartmentLabel,
        }),
        overdueLabel,
        activationHint,
        instanceStepId: step.id,
        projectStageId: null,
        openApproval,
        latestOfficialCode,
        canComplete,
        canSubmitApproval,
        canDecideApproval,
        canEditDeadline: Boolean(isActive && canManage && (step.status === "ready" || step.status === "in_progress")),
        warningHours,
        deadlineState,
        remainingLabel,
        overdueSinceLabel,
        workflowStepId: step.step_id,
        responsibleUserId: step.responsible_user_id,
        canAssignResponsible: Boolean(canManage && canReassignWorkflowStepStatus(step.status)),
        stepKey: step.step_key,
      };
    });

    const currentNodeId = pickCurrentNodeId(nodes);
    const current = nodes.find((n) => n.id === currentNodeId) ?? null;
    const progress = deriveStageProgress(nodes);
    const attention = buildProjectAttention({
      mode: "workflow",
      instanceStatus: instance.status,
      current,
    });

    return {
      mode: "workflow",
      instanceId: instance.id,
      instanceStatus: instance.status,
      definitionName: definition?.name_ar ?? null,
      nodes,
      progress,
      currentNodeId,
      attention,
      nextRequiredAction: attention.detail,
    };
  }

  const { data: publishedDefs } = await supabase
    .from("workflow_definitions")
    .select("id, name_ar, code")
    .eq("status", "published")
    .eq("entity_type", "project")
    .or(`organization_id.eq.${ctx.organization.id},organization_id.is.null`);
  const previewDef =
    (publishedDefs ?? []).find((d) => d.code === "project_lifecycle") ?? (publishedDefs ?? [])[0] ?? null;

  if (previewDef) {
    const { data: version } = await supabase
      .from("workflow_versions")
      .select("id")
      .eq("definition_id", previewDef.id)
      .eq("status", "published")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    const { data: templateSteps } = version
      ? await supabase
          .from("workflow_steps")
          .select("id, key, name_ar, name_en, sequence, assigned_role_id, assigned_department_id, assigned_user_id, requires_approval, warning_hours, sla_hours")
          .eq("version_id", version.id)
          .order("sequence")
      : { data: [] as Array<Record<string, unknown>> };
    const { data: assignmentRows } = await supabase
      .from("project_workflow_step_assignments")
      .select("project_id, workflow_step_id, responsible_user_id")
      .eq("organization_id", ctx.organization.id)
      .eq("project_id", projectId);

    if (templateSteps && templateSteps.length > 0) {
      const assignedByStep = indexStepAssignments(
        (assignmentRows ?? []).map((row) => ({
          projectId: String(row.project_id ?? projectId),
          workflowStepId: String(row.workflow_step_id),
          responsibleUserId: String(row.responsible_user_id),
        })),
        projectId,
      );
      const canManage = hasPermission(ctx, WORKFLOW_ASSIGN_PERMISSION);
      const nodes: WorkflowViewNode[] = templateSteps.map((step) => {
        const responsibleUserId = assignedByStep.get(String(step.id).toLowerCase()) ?? null;
        const assignment = resolveStageAssignment({
          responsibleUserId,
          assignedUserId: (step.assigned_user_id as string | null) ?? null,
          assignedRoleId: (step.assigned_role_id as string | null) ?? null,
          assignedDepartmentId: (step.assigned_department_id as string | null) ?? null,
          profileNames,
          roleNames,
          departmentNames,
          jobTitles,
        });
        const responsibleLabel = assignment.kind === "user" ? assignment.label : null;
        const visual = mapEngineStatusToVisual({
          engineStatus: "pending",
          requiresApproval: Boolean(step.requires_approval),
          dueAt: null,
          nowIso,
          openApproval: null,
          latestOfficialCode: null,
        });
        return {
          id: step.id as string,
          source: "workflow",
          sequence: step.sequence as number,
          nameAr: step.name_ar as string,
          nameEn: step.name_en as string,
          visual,
          visualLabel: workflowVisualLabel(visual),
          engineStatus: "pending",
          gate: step.requires_approval ? "APPROVAL" : "MANUAL_COMPLETION",
          requiresApproval: Boolean(step.requires_approval),
          responsibleLabel,
          assignmentKind: assignment.kind,
          assignmentSubtitle: assignment.subtitle,
          requiredRoleLabel: assignment.requiredRoleLabel,
          requiredDepartmentLabel: assignment.requiredDepartmentLabel,
          approverLabel: null,
          startedAt: null,
          dueAt: null,
          completedAt: null,
          completedByLabel: null,
          blockReason: "بانتظار بدء مسار العمل",
          overdueLabel: null,
          activationHint: null,
          instanceStepId: null,
          projectStageId: null,
          openApproval: null,
          latestOfficialCode: null,
          canComplete: false,
          canSubmitApproval: false,
          canDecideApproval: false,
          canEditDeadline: false,
          warningHours: (step.warning_hours as number | null) ?? null,
          deadlineState: "ON_TRACK",
          remainingLabel: null,
          overdueSinceLabel: null,
          workflowStepId: step.id as string,
          responsibleUserId,
          canAssignResponsible: canManage,
          stepKey: (step.key as string | null) ?? null,
        };
      });
      const currentNodeId = pickCurrentNodeId(nodes);
      const progress = deriveStageProgress(nodes);
      const attention = buildProjectAttention({ mode: "preview", instanceStatus: null, current: null });
      return {
        mode: "preview",
        instanceId: null,
        instanceStatus: null,
        definitionName: previewDef.name_ar,
        nodes,
        progress,
        currentNodeId,
        attention,
        nextRequiredAction: attention.detail,
      };
    }
  }

  if (stages.length === 0) {
    const attention = buildProjectAttention({ mode: "empty", instanceStatus: null, current: null });
    return {
      mode: "empty",
      instanceId: null,
      instanceStatus: null,
      definitionName: null,
      nodes: [],
      progress: { completed: 0, total: 0, percent: 0 },
      currentNodeId: null,
      attention,
      nextRequiredAction: attention.detail,
    };
  }

  const canUpdate = hasPermission(ctx, "project.update");
  const nodes: WorkflowViewNode[] = stages.map((stage) => {
    const visual = mapEngineStatusToVisual({
      engineStatus: stage.status === "not_started" ? "pending" : stage.status,
      requiresApproval: false,
      dueAt: stage.due_at,
      nowIso,
      openApproval: null,
      latestOfficialCode: null,
    });
    const overdueLabel = stage.due_at ? formatOverdueDurationAr(stage.due_at, nowIso) : null;
    const assignment = resolveStageAssignment({
      assignedUserId: stage.owner_user_id,
      assignedRoleId: null,
      assignedDepartmentId: null,
      profileNames,
      roleNames,
      departmentNames,
      jobTitles,
    });
    const responsibleLabel = assignment.kind === "user" ? assignment.label : null;
    return {
      id: stage.id,
      source: "legacy",
      sequence: stage.sequence,
      nameAr: stage.name_ar,
      nameEn: stage.name_en,
      visual,
      visualLabel: workflowVisualLabel(visual),
      engineStatus: stage.status,
      gate: "MANUAL_COMPLETION",
      requiresApproval: Boolean(stage.requires_approval),
      responsibleLabel,
      assignmentKind: assignment.kind,
      assignmentSubtitle: assignment.subtitle,
      requiredRoleLabel: assignment.requiredRoleLabel,
      requiredDepartmentLabel: assignment.requiredDepartmentLabel,
      approverLabel: null,
      startedAt: stage.actual_start,
      dueAt: stage.due_at ?? stage.planned_end,
      completedAt: stage.actual_end,
      completedByLabel: null,
      blockReason: blockReasonForNode({
        visual,
        requiresApproval: Boolean(stage.requires_approval),
        openApproval: null,
        latestOfficialCode: null,
        overdueLabel,
        missingAssignee: false,
      }),
      overdueLabel,
      activationHint: visual === "current" ? "بعد الإكمال تُفعَّل المرحلة التالية تلقائياً" : null,
      instanceStepId: null,
      projectStageId: stage.id,
      openApproval: null,
      latestOfficialCode: null,
      canComplete: false,
      canSubmitApproval: false,
      canDecideApproval: false,
      canEditDeadline: false,
      warningHours: null,
      deadlineState: deriveDeadlineState({
        engineStatus: stage.status === "not_started" ? "pending" : stage.status,
        dueAt: stage.due_at ?? stage.planned_end,
        warningHours: null,
        nowIso,
      }),
      remainingLabel: stage.due_at || stage.planned_end ? formatRemainingAr((stage.due_at ?? stage.planned_end) as string, nowIso) : null,
      overdueSinceLabel: stage.due_at || stage.planned_end ? formatOverdueSinceAr((stage.due_at ?? stage.planned_end) as string, nowIso) : null,
      workflowStepId: null,
      responsibleUserId: stage.owner_user_id,
      canAssignResponsible: false,
      stepKey: null,
    };
  });

  const currentNodeId = pickCurrentNodeId(nodes);
  for (const node of nodes) {
    node.canComplete = Boolean(canUpdate && node.id === currentNodeId && node.visual !== "completed");
    if (node.visual === "current" && nodes.find((n) => n.sequence === node.sequence - 1)?.visual === "completed") {
      node.activationHint = "تم الانتقال تلقائياً بعد اكتمال المرحلة السابقة";
    }
  }

  const current = nodes.find((n) => n.id === currentNodeId) ?? null;
  const progress = deriveStageProgress(nodes);
  const attention = buildProjectAttention({
    mode: "legacy",
    instanceStatus: null,
    current,
  });

  return {
    mode: "legacy",
    instanceId: null,
    instanceStatus: null,
    definitionName: null,
    nodes,
    progress,
    currentNodeId,
    attention,
    nextRequiredAction: attention.detail,
  };
}
