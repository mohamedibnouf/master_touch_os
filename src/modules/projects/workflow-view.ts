export type WorkflowVisualState =
  | "completed"
  | "current"
  | "waiting_approval"
  | "changes_requested"
  | "rejected"
  | "blocked"
  | "overdue"
  | "upcoming";

export type WorkflowGateKind = "MANUAL_COMPLETION" | "APPROVAL" | "WORKFLOW_STEP";

export type OfficialApprovalCode = "A" | "B" | "C" | "D" | "E";

export type WorkflowOutcome = "complete" | "reject" | "resubmit";

export type AttentionKind =
  | "none"
  | "start_workflow"
  | "complete"
  | "submit_approval"
  | "approve"
  | "wait"
  | "changes_requested"
  | "rejected"
  | "workflow_complete"
  | "config";

export type OpenApprovalSnapshot = {
  requestId: string;
  stepId: string;
  status: string;
  approverUserId: string | null;
  approverLabel: string | null;
};

export type ProjectAttention = {
  kind: AttentionKind;
  title: string;
  detail: string;
  waitForLabel: string | null;
};

const VISUAL_LABEL: Record<WorkflowVisualState, string> = {
  completed: "مكتملة",
  current: "المرحلة الحالية",
  waiting_approval: "بانتظار موافقة",
  changes_requested: "تم طلب تعديل",
  rejected: "تم الرفض",
  blocked: "موقوفة",
  overdue: "متأخرة",
  upcoming: "قادمة",
};

export function workflowVisualLabel(state: WorkflowVisualState): string {
  return VISUAL_LABEL[state];
}

export function officialCodeToWorkflowOutcome(
  code: OfficialApprovalCode,
): WorkflowOutcome | null {
  if (code === "A" || code === "B") return "complete";
  if (code === "C") return "resubmit";
  if (code === "D") return "reject";
  return null;
}

export function deriveStageProgress(
  nodes: Array<{ visual: WorkflowVisualState; engineStatus?: string }>,
): {
  completed: number;
  total: number;
  percent: number;
} {
  const applicable = nodes.filter((n) => n.engineStatus !== "cancelled");
  const total = applicable.length;
  if (total === 0) {
    return { completed: 0, total: 0, percent: 0 };
  }
  const completed = applicable.filter(
    (n) => n.visual === "completed" || n.engineStatus === "skipped",
  ).length;
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
  };
}

export function formatOverdueDurationAr(dueAt: string, nowIso: string): string | null {
  const due = Date.parse(dueAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(due) || !Number.isFinite(now) || now <= due) return null;
  const days = Math.floor((now - due) / 86_400_000);
  if (days <= 0) return "متأخرة";
  if (days === 1) return "متأخرة يوماً";
  if (days === 2) return "متأخرة يومين";
  return `متأخرة ${days} أيام`;
}

export function mapEngineStatusToVisual(input: {
  engineStatus: string;
  requiresApproval: boolean;
  dueAt: string | null;
  nowIso: string;
  openApproval: OpenApprovalSnapshot | null;
  latestOfficialCode: OfficialApprovalCode | null;
}): WorkflowVisualState {
  const status = input.engineStatus;
  if (status === "completed" || status === "skipped") return "completed";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "blocked";
  if (status === "pending" || status === "not_started") return "upcoming";

  const active = status === "ready" || status === "in_progress" || status === "blocked";
  if (!active) return "upcoming";

  const overdue = Boolean(input.dueAt && formatOverdueDurationAr(input.dueAt, input.nowIso));
  const waiting = Boolean(
    input.openApproval && ["pending", "in_progress"].includes(input.openApproval.status),
  );
  const approvalGateOpen = input.requiresApproval && waiting;

  if (input.latestOfficialCode === "C" && !waiting) {
    return overdue ? "overdue" : "changes_requested";
  }
  if (approvalGateOpen && (status === "ready" || status === "in_progress")) {
    return overdue ? "overdue" : "waiting_approval";
  }
  if (status === "blocked") return overdue ? "overdue" : "blocked";
  if (overdue) return "overdue";
  return "current";
}

export function waitingApprovalPhrase(approverLabel: string | null): string {
  if (approverLabel) return `بانتظار موافقة ${approverLabel}`;
  return "بانتظار موافقة";
}

export function blockReasonForNode(input: {
  visual: WorkflowVisualState;
  requiresApproval: boolean;
  openApproval: OpenApprovalSnapshot | null;
  latestOfficialCode: OfficialApprovalCode | null;
  overdueLabel: string | null;
  missingAssignee: boolean;
}): string | null {
  if (input.visual === "upcoming") return "بانتظار إكمال المرحلة السابقة";
  if (input.visual === "rejected") return "تم الرفض";
  if (input.visual === "changes_requested") return "المدير طلب تعديلات";
  if (input.missingAssignee && input.requiresApproval) {
    return "لم يُحدد معتمد لهذه المرحلة";
  }
  if (input.visual === "waiting_approval" || (input.visual === "overdue" && input.openApproval)) {
    return waitingApprovalPhrase(input.openApproval?.approverLabel ?? null);
  }
  if (input.visual === "overdue") return input.overdueLabel;
  if (input.visual === "blocked") return "المرحلة موقوفة";
  return null;
}

export function buildProjectAttention(input: {
  mode: "workflow" | "legacy" | "empty" | "preview";
  instanceStatus: string | null;
  current: {
    nameAr: string;
    visual: WorkflowVisualState;
    canComplete: boolean;
    canSubmitApproval: boolean;
    canDecideApproval: boolean;
    approverLabel: string | null;
    responsibleLabel: string | null;
    blockReason: string | null;
    latestOfficialCode: OfficialApprovalCode | null;
  } | null;
}): ProjectAttention {
  if (input.mode === "empty") {
    return {
      kind: "start_workflow",
      title: "لا يوجد مسار عمل نشط",
      detail: "يمكن بدء مسار عمل معتمد أو متابعة مراحل المشروع الحالية.",
      waitForLabel: null,
    };
  }

  if (input.mode === "preview") {
    return {
      kind: "start_workflow",
      title: "مسار العمل لم يبدأ بعد",
      detail: "عيّن مسؤول كل مرحلة ثم ابدأ المسار.",
      waitForLabel: null,
    };
  }

  if (input.instanceStatus === "completed") {
    return {
      kind: "workflow_complete",
      title: "اكتمل مسار العمل",
      detail: "جميع المراحل مكتملة. يمكن مراجعة السجل من تفاصيل كل مرحلة.",
      waitForLabel: null,
    };
  }

  if (input.instanceStatus === "cancelled") {
    return {
      kind: "rejected",
      title: "أُلغي مسار العمل",
      detail: "توقف المسار بعد قرار رفض دون مسار عودة محدد.",
      waitForLabel: null,
    };
  }

  const current = input.current;
  if (!current) {
    return {
      kind: "none",
      title: "لا يوجد إجراء مطلوب منك حالياً",
      detail: "لا توجد مرحلة نشطة تحتاج تدخلك الآن.",
      waitForLabel: null,
    };
  }

  if (current.canDecideApproval) {
    return {
      kind: "approve",
      title: "يتطلب إجراء منك",
      detail: `موافقة على المرحلة: ${current.nameAr}`,
      waitForLabel: null,
    };
  }

  if (current.canSubmitApproval) {
    return {
      kind: "submit_approval",
      title: "يتطلب إجراء منك",
      detail: `إرسال مرحلة ${current.nameAr} للاعتماد`,
      waitForLabel: null,
    };
  }

  if (current.canComplete) {
    return {
      kind: "complete",
      title: "يتطلب إجراء منك",
      detail: `إكمال المرحلة: ${current.nameAr}`,
      waitForLabel: null,
    };
  }

  if (current.visual === "changes_requested" || current.latestOfficialCode === "C") {
    return {
      kind: "changes_requested",
      title: "المدير طلب تعديلات",
      detail: current.responsibleLabel
        ? `المسؤول: ${current.responsibleLabel}`
        : "أعد العمل ثم أرسل المرحلة مجدداً للاعتماد.",
      waitForLabel: current.responsibleLabel,
    };
  }

  if (current.visual === "rejected") {
    return {
      kind: "rejected",
      title: "تم الرفض",
      detail: current.blockReason ?? "رُفضت المرحلة وفق مسار الاعتماد.",
      waitForLabel: null,
    };
  }

  if (current.visual === "waiting_approval" || current.visual === "overdue") {
    const wait = waitingApprovalPhrase(current.approverLabel);
    return {
      kind: "wait",
      title: wait,
      detail: current.blockReason ?? wait,
      waitForLabel: current.approverLabel,
    };
  }

  if (current.responsibleLabel) {
    return {
      kind: "wait",
      title: `بانتظار ${current.responsibleLabel}`,
      detail: current.blockReason ?? `المرحلة الحالية: ${current.nameAr}`,
      waitForLabel: current.responsibleLabel,
    };
  }

  return {
    kind: "none",
    title: "لا يوجد إجراء مطلوب منك حالياً",
    detail: `المرحلة الحالية: ${current.nameAr}`,
    waitForLabel: null,
  };
}

export function canCompleteLegacyStage(
  stages: Array<{ id: string; sequence: number; status: string }>,
  stageId: string,
): { ok: true } | { ok: false; reason: "not_found" | "already_completed" | "out_of_order" } {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((s) => s.id === stageId);
  if (index < 0) return { ok: false, reason: "not_found" };
  const current = ordered[index]!;
  if (current.status === "completed" || current.status === "skipped") {
    return { ok: false, reason: "already_completed" };
  }
  for (let i = 0; i < index; i += 1) {
    const prev = ordered[i]!;
    if (prev.status !== "completed" && prev.status !== "skipped") {
      return { ok: false, reason: "out_of_order" };
    }
  }
  return { ok: true };
}

export function applyLegacyStageCompletion(
  stages: Array<{ id: string; sequence: number; status: string }>,
  stageId: string,
  today: string,
):
  | {
      ok: true;
      updates: Array<{ id: string; status: string; actual_end?: string; actual_start?: string; progress_percentage?: number }>;
    }
  | { ok: false; reason: "not_found" | "already_completed" | "out_of_order" } {
  const allowed = canCompleteLegacyStage(stages, stageId);
  if (!allowed.ok) return allowed;

  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex((s) => s.id === stageId);
  const updates: Array<{
    id: string;
    status: string;
    actual_end?: string;
    actual_start?: string;
    progress_percentage?: number;
  }> = [
    {
      id: stageId,
      status: "completed",
      actual_end: today,
      progress_percentage: 100,
    },
  ];
  const next = ordered[index + 1];
  if (next && next.status !== "completed" && next.status !== "skipped") {
    updates.push({
      id: next.id,
      status: "in_progress",
      actual_start: today,
    });
  }
  return { ok: true, updates };
}

export function pickCurrentNodeId(nodes: Array<{ id: string; visual: WorkflowVisualState }>): string | null {
  const priority: WorkflowVisualState[] = [
    "overdue",
    "waiting_approval",
    "changes_requested",
    "current",
    "rejected",
    "blocked",
  ];
  for (const visual of priority) {
    const match = nodes.find((n) => n.visual === visual);
    if (match) return match.id;
  }
  return nodes.find((n) => n.visual !== "completed" && n.visual !== "upcoming")?.id ?? null;
}

export type StageAssignmentKind = "user" | "role" | "department" | "none";

export type StageAssignmentView = {
  kind: StageAssignmentKind;
  label: string;
  subtitle: string | null;
  responsibleUserId: string | null;
  requiredRoleLabel: string | null;
  requiredDepartmentLabel: string | null;
};

export function indexStepAssignments(
  rows: Array<{ projectId: string; workflowStepId: string; responsibleUserId: string }>,
  projectId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.projectId !== projectId) continue;
    map.set(row.workflowStepId.toLowerCase(), row.responsibleUserId);
  }
  return map;
}

export function resolveStageAssignment(input: {
  responsibleUserId?: string | null;
  assignedUserId: string | null;
  assignedRoleId: string | null;
  assignedDepartmentId: string | null;
  profileNames: Map<string, string>;
  roleNames: Map<string, string>;
  departmentNames: Map<string, string>;
  jobTitles: Map<string, string>;
}): StageAssignmentView {
  const requiredRoleLabel = input.assignedRoleId
    ? (input.roleNames.get(input.assignedRoleId) ?? "دور معيّن")
    : null;
  const requiredDepartmentLabel = input.assignedDepartmentId
    ? (input.departmentNames.get(input.assignedDepartmentId) ?? "قسم معيّن")
    : null;
  const displayUserId = input.responsibleUserId || input.assignedUserId || null;
  if (displayUserId) {
    return {
      kind: "user",
      label: input.profileNames.get(displayUserId) ?? "مستخدم معيّن",
      subtitle: input.jobTitles.get(displayUserId) ?? null,
      responsibleUserId: displayUserId,
      requiredRoleLabel,
      requiredDepartmentLabel,
    };
  }
  return {
    kind: "none",
    label: "غير محدد",
    subtitle: null,
    responsibleUserId: null,
    requiredRoleLabel,
    requiredDepartmentLabel,
  };
}
