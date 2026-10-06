export const WORKFLOW_STEP_ACTIONABLE_STATUSES = ["ready", "in_progress"] as const;
export const WORKFLOW_INSTANCE_ACTIONABLE_STATUSES = ["in_progress"] as const;

export type WorkflowStepExecutionFacts = {
  authUserId: string | null;
  instanceExists: boolean;
  stepExists: boolean;
  stepBelongsToInstance: boolean;
  profileActive: boolean;
  orgMembershipActive: boolean;
  organizationMatches: boolean;
  entityType: string;
  canAccessProject: boolean;
  isActiveProjectParticipant: boolean;
  hasEmployeeRow: boolean;
  employeeActive: boolean;
  stepStatus: string;
  instanceStatus: string;
  responsibleUserId: string | null;
  hasWorkflowManage: boolean;
  hasWorkflowAdvance: boolean;
  canActOnWorkflowStep: boolean;
};

export function existingWorkflowExecutionPath(facts: WorkflowStepExecutionFacts): boolean {
  if (!facts.authUserId) return false;
  const manage = facts.hasWorkflowManage;
  const advance = facts.hasWorkflowAdvance;
  if (!(advance || manage)) return false;
  if (!(manage || facts.canActOnWorkflowStep)) return false;
  return true;
}

export function canExecuteAsStepLocalResponsible(facts: WorkflowStepExecutionFacts): boolean {
  if (!facts.authUserId) return false;
  if (!facts.instanceExists || !facts.stepExists) return false;
  if (!facts.stepBelongsToInstance) return false;
  if (!facts.profileActive) return false;
  if (!facts.orgMembershipActive) return false;
  if (!facts.organizationMatches) return false;
  if (facts.entityType === "project") {
    if (!facts.canAccessProject) return false;
    if (!facts.isActiveProjectParticipant) return false;
  }
  if (facts.hasEmployeeRow && !facts.employeeActive) return false;
  if (!WORKFLOW_STEP_ACTIONABLE_STATUSES.includes(facts.stepStatus as (typeof WORKFLOW_STEP_ACTIONABLE_STATUSES)[number])) {
    return false;
  }
  if (!WORKFLOW_INSTANCE_ACTIONABLE_STATUSES.includes(facts.instanceStatus as (typeof WORKFLOW_INSTANCE_ACTIONABLE_STATUSES)[number])) {
    return false;
  }
  return facts.responsibleUserId === facts.authUserId;
}

export function canExecuteWorkflowInstanceStep(facts: WorkflowStepExecutionFacts): boolean {
  return existingWorkflowExecutionPath(facts) || canExecuteAsStepLocalResponsible(facts);
}

export const WORKFLOW_STEP_EXECUTION_RPC = "can_execute_workflow_instance_step";

const MISSING_EXECUTION_RPC_CODES = new Set(["PGRST202", "42883"]);

const MISSING_EXECUTION_RPC_PATTERNS = [
  /Could not find the function (?:public\.)?can_execute_workflow_instance_step\b/,
  /Searched for the function (?:public\.)?can_execute_workflow_instance_step\b/,
  /function (?:public\.)?can_execute_workflow_instance_step(?:\s*\([^)]*\))?\s+does not exist/i,
];

export type WorkflowExecutionRpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export function isMissingWorkflowExecutionRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as WorkflowExecutionRpcError;
  if (typeof e.code !== "string" || !MISSING_EXECUTION_RPC_CODES.has(e.code)) return false;
  const primary = `${e.message ?? ""}\n${e.details ?? ""}`;
  return MISSING_EXECUTION_RPC_PATTERNS.some((pattern) => pattern.test(primary));
}

export type WorkflowExecutionLookupInput = {
  canManage: boolean;
  canAdvance: boolean;
  executeOk: boolean | null;
  executeError: unknown | null;
  legacyCanAct: boolean | null;
};

export type WorkflowExecutionLookupResult = {
  canExecute: boolean;
  usedLegacyFallback: boolean;
  failedClosed: boolean;
  shouldCallLegacyCanAct: boolean;
};

export function resolveWorkflowStepExecutionLookup(
  input: WorkflowExecutionLookupInput,
): WorkflowExecutionLookupResult {
  if (input.executeError == null) {
    return {
      canExecute: input.executeOk === true,
      usedLegacyFallback: false,
      failedClosed: false,
      shouldCallLegacyCanAct: false,
    };
  }

  if (isMissingWorkflowExecutionRpcError(input.executeError)) {
    if (input.canManage) {
      return {
        canExecute: true,
        usedLegacyFallback: true,
        failedClosed: false,
        shouldCallLegacyCanAct: false,
      };
    }
    const shouldCallLegacyCanAct = input.canAdvance;
    return {
      canExecute: shouldCallLegacyCanAct && input.legacyCanAct === true,
      usedLegacyFallback: shouldCallLegacyCanAct,
      failedClosed: false,
      shouldCallLegacyCanAct,
    };
  }

  return {
    canExecute: false,
    usedLegacyFallback: false,
    failedClosed: true,
    shouldCallLegacyCanAct: false,
  };
}
