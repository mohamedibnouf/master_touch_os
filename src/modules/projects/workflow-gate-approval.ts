import { isPostgresUuid } from "@/lib/postgres-uuid";

export type GateDerivationFailure =
  | "NO_ACTIVE_WORKFLOW"
  | "NO_ACTIONABLE_GATE"
  | "GATE_NOT_REQUIRED"
  | "CROSS_PROJECT"
  | "CROSS_ORG"
  | "STEP_NOT_CURRENT";

export type GateInstanceRow = {
  id: string;
  organizationId: string;
  status: string;
  entityType: string;
  entityId: string;
};

export type GateStepRow = {
  id: string;
  instanceId: string;
  organizationId: string;
  status: string;
  sequence: number;
  requiresApproval: boolean;
};

export function deriveCurrentWorkflowGate(input: {
  projectId: string;
  organizationId: string;
  instance: GateInstanceRow | null;
  steps: GateStepRow[];
}): { ok: true; instanceStepId: string; instanceId: string } | { ok: false; reason: GateDerivationFailure } {
  const instance = input.instance;
  if (!instance || instance.status !== "in_progress") {
    return { ok: false, reason: "NO_ACTIVE_WORKFLOW" };
  }
  if (instance.organizationId !== input.organizationId) {
    return { ok: false, reason: "CROSS_ORG" };
  }
  if (instance.entityType !== "project" || instance.entityId !== input.projectId) {
    return { ok: false, reason: "CROSS_PROJECT" };
  }
  const current = [...input.steps]
    .filter(
      (s) =>
        s.instanceId === instance.id &&
        s.organizationId === input.organizationId &&
        (s.status === "ready" || s.status === "in_progress"),
    )
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!current) return { ok: false, reason: "NO_ACTIONABLE_GATE" };
  if (!current.requiresApproval) return { ok: false, reason: "GATE_NOT_REQUIRED" };
  return { ok: true, instanceStepId: current.id, instanceId: instance.id };
}

export function rejectBrowserStepSubstitution(input: {
  derivedInstanceStepId: string;
  browserInstanceStepId: string | null;
}): { ok: true } | { ok: false; reason: "STEP_NOT_CURRENT" } {
  if (!input.browserInstanceStepId) return { ok: true };
  if (input.browserInstanceStepId !== input.derivedInstanceStepId) {
    return { ok: false, reason: "STEP_NOT_CURRENT" };
  }
  return { ok: true };
}

export type SupportingDocumentCandidate = {
  documentId: string;
  documentVersionId: string;
  organizationId: string;
  projectId: string | null;
  archivedAt: string | null;
  documentStatus: string;
  revision: string;
};

export type DocumentValidationFailure =
  | "DOCUMENT_INVALID"
  | "DOCUMENT_ARCHIVED"
  | "DOCUMENT_PROJECT_MISMATCH"
  | "DOCUMENT_REQUIRED"
  | "CROSS_ORG";

export function validateSupportingDocument(input: {
  organizationId: string;
  projectId: string;
  candidate: SupportingDocumentCandidate | null;
}): { ok: true; frozen: { documentId: string; documentVersionId: string; revision: string } } | { ok: false; reason: DocumentValidationFailure } {
  const row = input.candidate;
  if (!row) return { ok: false, reason: "DOCUMENT_INVALID" };
  if (row.organizationId !== input.organizationId) return { ok: false, reason: "CROSS_ORG" };
  if (row.archivedAt || row.documentStatus === "archived") return { ok: false, reason: "DOCUMENT_ARCHIVED" };
  if (row.projectId !== input.projectId) return { ok: false, reason: "DOCUMENT_PROJECT_MISMATCH" };
  return {
    ok: true,
    frozen: {
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
      revision: row.revision,
    },
  };
}

export function approvalArtifactRemainsFrozen(input: {
  linkedVersionId: string;
  linkedRevision: string;
  originalVersionId: string;
  originalRevision: string;
  documentCurrentRevision: string;
  documentCurrentVersionId: string;
}): boolean {
  return (
    input.linkedVersionId === input.originalVersionId &&
    input.linkedRevision === input.originalRevision &&
    input.documentCurrentRevision !== input.linkedRevision &&
    input.documentCurrentVersionId !== input.linkedVersionId
  );
}

export function parseGateApprovalForm(formData: FormData):
  | {
      ok: true;
      projectId: string;
      approverProfileId: string;
      title: string | undefined;
      documentVersionIds: string[];
    }
  | { ok: false } {
  const projectId = String(formData.get("projectId") ?? "");
  const approverProfileId = String(formData.get("approverProfileId") ?? "");
  const titleRaw = String(formData.get("title") ?? "").trim();
  if (!isPostgresUuid(projectId) || !isPostgresUuid(approverProfileId)) {
    return { ok: false };
  }
  const documentVersionIds = formData
    .getAll("documentVersionId")
    .map((v) => String(v))
    .filter((v) => isPostgresUuid(v));
  return {
    ok: true,
    projectId,
    approverProfileId,
    title: titleRaw.length >= 2 ? titleRaw : undefined,
    documentVersionIds,
  };
}

export function ignoredBrowserGateFields(formData: FormData): string[] {
  const names = ["entityType", "entityId", "instanceStepId", "workflow_instance_id", "workflow_instance_step_id", "workflow_step_id"];
  return names.filter((name) => String(formData.get(name) ?? "").length > 0);
}

export function isEligibleGateApprover(input: {
  memberStatus: string;
  profileActive: boolean;
  hasEmployeeRow: boolean;
  employeeActive: boolean;
}): boolean {
  if (input.memberStatus !== "active") return false;
  if (!input.profileActive) return false;
  if (input.hasEmployeeRow && !input.employeeActive) return false;
  return true;
}
