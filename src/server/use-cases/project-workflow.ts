import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext, ProjectStage } from "@/types/models";
import { hasPermission } from "@/server/policies/authorize";
import {
  blockReasonForNode,
  buildProjectAttention,
  deriveStageProgress,
  formatOverdueDurationAr,
  mapEngineStatusToVisual,
  pickCurrentNodeId,
  waitingApprovalPhrase,
  workflowVisualLabel,
  type OfficialApprovalCode,
  type OpenApprovalSnapshot,
  type ProjectAttention,
  type WorkflowGateKind,
  type WorkflowVisualState,
} from "@/modules/projects/workflow-view";

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
};

export type ProjectWorkflowProjection = {
  mode: "workflow" | "legacy" | "empty";
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
}): Promise<ProjectWorkflowProjection> {
  const nowIso = new Date().toISOString();
  const { supabase, ctx, projectId, stages, profileNames, roleNames } = input;

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
          "id, sequence, status, started_at, completed_at, completed_by, assigned_user_id, assigned_role_id, due_at, step_key, step_id, workflow_steps(name_ar, name_en, requires_approval, assigned_role_id)",
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
    let canActOnActive = canManage;
    if (!canActOnActive && canAdvance && activeEngine) {
      const { data } = await supabase.rpc("can_act_on_workflow_step", {
        p_step_id: activeEngine.id,
      });
      canActOnActive = data === true;
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
      const responsibleLabel =
        (step.assigned_user_id ? profileNames.get(step.assigned_user_id) : null) ??
        (roleId ? roleNames.get(roleId) ?? null : null);
      const approverLabel = openApproval?.approverLabel ?? (requiresApproval ? responsibleLabel : null);
      const isActive = step.id === activeEngine?.id;
      const canAct = Boolean(isActive && canAdvance && canActOnActive);
      const canDecideApproval = Boolean(
        canApprove &&
          openApproval &&
          openApproval.approverUserId === ctx.userId &&
          (openStep?.status === "pending" || openStep?.status === "in_progress"),
      );
      const canSubmitApproval = Boolean(canAct && canCreateApproval && requiresApproval && !openApproval && isActive);
      const canComplete = Boolean(canAct && isActive && !openApproval && (!requiresApproval || latestOfficialCode === "A" || latestOfficialCode === "B"));

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
          missingAssignee: requiresApproval && !openApproval && !responsibleLabel,
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
    const responsibleLabel = stage.owner_user_id ? (profileNames.get(stage.owner_user_id) ?? null) : null;
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
