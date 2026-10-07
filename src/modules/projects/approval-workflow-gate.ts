import { decisionFromCode, type OfficialApprovalCode } from "@/server/domain/approval";
import type { WorkflowOutcome } from "@/server/domain/workflow";

export type WorkflowApprovalLink = {
  requestOrganizationId: string;
  entityType: string;
  entityId: string;
  stepOrganizationId: string | null;
  instanceOrganizationId: string | null;
  stepExists: boolean;
  instanceExists: boolean;
  instanceIsLive?: boolean;
  stepIsActionable?: boolean;
  boundProjectId?: string | null;
  instanceEntityType?: string | null;
  instanceEntityId?: string | null;
};

export function workflowOutcomeFromOfficialCode(code: OfficialApprovalCode): WorkflowOutcome | null {
  const decision = decisionFromCode(code);
  if (decision === "approved" || decision === "approved_as_noted") return "complete";
  if (decision === "resubmit") return "resubmit";
  if (decision === "rejected") return "reject";
  return null;
}

export function shouldApplyApprovalWorkflowGate(input: {
  entityType: string;
  requestStatus: string;
  officialCode: OfficialApprovalCode;
}): boolean {
  if (input.entityType !== "workflow_instance_step") return false;
  if (input.requestStatus !== "completed") return false;
  return workflowOutcomeFromOfficialCode(input.officialCode) !== null;
}

export function validateWorkflowApprovalLink(link: WorkflowApprovalLink): "ok" | "WORKFLOW_LINK_INVALID" {
  if (link.entityType !== "workflow_instance_step") return "ok";
  if (!link.stepExists || !link.instanceExists) return "WORKFLOW_LINK_INVALID";
  if (link.stepOrganizationId !== link.requestOrganizationId) return "WORKFLOW_LINK_INVALID";
  if (link.instanceOrganizationId !== link.requestOrganizationId) return "WORKFLOW_LINK_INVALID";
  if (link.instanceIsLive === false) return "WORKFLOW_LINK_INVALID";
  if (link.stepIsActionable === false) return "WORKFLOW_LINK_INVALID";
  if (
    link.boundProjectId &&
    (link.instanceEntityType !== "project" || link.instanceEntityId !== link.boundProjectId)
  ) {
    return "WORKFLOW_LINK_INVALID";
  }
  return "ok";
}

export function canDirectCompleteApprovalGate(input: {
  requiresApproval: boolean;
  source: "direct" | "approval_gate";
  satisfiedOfficialCodes: string[];
}): boolean {
  if (input.source === "approval_gate") return true;
  if (!input.requiresApproval) return true;
  return input.satisfiedOfficialCodes.some((code) => code === "A" || code === "B");
}

export function mapWorkflowRpcError(message: string): {
  kind: "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "NOT_FOUND" | "DATABASE";
  ar: string;
  en: string;
} {
  if (message.includes("DUPLICATE_OPEN_GATE")) {
    return {
      kind: "CONFLICT",
      ar: "يوجد طلب اعتماد مفتوح لهذه المرحلة.",
      en: "An open approval already exists for this stage.",
    };
  }
  if (message.includes("CONFLICT")) {
    return { kind: "CONFLICT", ar: "تم اتخاذ هذا الإجراء مسبقاً.", en: "This action was already processed." };
  }
  if (message.includes("FORBIDDEN")) {
    return { kind: "FORBIDDEN", ar: "ليست لديك صلاحية لتنفيذ هذه العملية.", en: "You cannot perform this action." };
  }
  if (message.includes("NO_ACTIVE_WORKFLOW")) {
    return {
      kind: "VALIDATION",
      ar: "لا يوجد مسار عمل نشط لهذا المشروع.",
      en: "This project has no active workflow instance.",
    };
  }
  if (message.includes("NO_ACTIONABLE_GATE") || message.includes("GATE_NOT_REQUIRED")) {
    return {
      kind: "VALIDATION",
      ar: "المرحلة الحالية ليست بوابة اعتماد جاهزة.",
      en: "The current stage is not an actionable approval gate.",
    };
  }
  if (message.includes("DOCUMENT_ARCHIVED")) {
    return {
      kind: "VALIDATION",
      ar: "لا يمكن ربط مستند مؤرشف بطلب الاعتماد.",
      en: "An archived document cannot be linked to this approval.",
    };
  }
  if (message.includes("DOCUMENT_PROJECT_MISMATCH") || message.includes("DOCUMENT_INVALID")) {
    return {
      kind: "VALIDATION",
      ar: "المستند الداعم لا ينتمي إلى هذا المشروع.",
      en: "The supporting document does not belong to this project.",
    };
  }
  if (message.includes("DOCUMENT_REQUIRED")) {
    return {
      kind: "VALIDATION",
      ar: "اختر مستنداً داعماً واحداً على الأقل.",
      en: "Select at least one supporting document.",
    };
  }
  if (message.includes("WORKFLOW_PROCUREMENT_NOT_READY")) {
    return {
      kind: "VALIDATION",
      ar: "لا يمكن إكمال مرحلة المشتريات بعد. أكمل دورة الشراء المطلوبة وأصدر أمر شراء واحدًا على الأقل قبل إكمال المرحلة.",
      en: "Procurement cannot be completed until a coherent issued purchase order exists for this project.",
    };
  }
  if (message.includes("WORKFLOW_GATE_REQUIRED")) {
    return {
      kind: "VALIDATION",
      ar: "لا يمكن إكمال هذه المرحلة قبل استيفاء بوابة الاعتماد.",
      en: "This step cannot be completed until its approval gate is satisfied.",
    };
  }
  if (message.includes("WORKFLOW_LINK_INVALID")) {
    return {
      kind: "VALIDATION",
      ar: "ارتباط الاعتماد بمسار العمل غير صالح.",
      en: "The approval is not validly linked to this workflow step.",
    };
  }
  if (message.includes("VALIDATION")) {
    return {
      kind: "VALIDATION",
      ar: "تعذر تطبيق الانتقال على مسار العمل. تحقق من إعداد المرحلة.",
      en: "The workflow transition could not be applied.",
    };
  }
  if (message.includes("NOT_FOUND")) {
    return { kind: "NOT_FOUND", ar: "العنصر غير موجود.", en: "Not found." };
  }
  return { kind: "DATABASE", ar: "حدث خطأ أثناء حفظ البيانات. حاول مرة أخرى.", en: "A data error occurred." };
}

export function activityNarrative(action: string, newValues: unknown): string | null {
  if (action !== "workflow.step.completed" && action !== "project.stage.started") return null;
  if (!newValues || typeof newValues !== "object") return null;
  const payload = newValues as Record<string, unknown>;
  if (payload.automatic === true && action === "workflow.step.completed") {
    return "تم الانتقال تلقائياً بعد اكتمال الموافقة";
  }
  if (payload.automatic === true && action === "project.stage.started") {
    return "انتقل المشروع تلقائياً إلى المرحلة التالية";
  }
  return null;
}
