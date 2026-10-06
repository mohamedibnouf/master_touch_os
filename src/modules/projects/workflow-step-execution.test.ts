import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveWorkflowStepActions } from "./workflow-view";
import {
  canExecuteAsStepLocalResponsible,
  canExecuteWorkflowInstanceStep,
  existingWorkflowExecutionPath,
  isMissingWorkflowExecutionRpcError,
  resolveWorkflowStepExecutionLookup,
  type WorkflowStepExecutionFacts,
} from "./workflow-step-execution";

const sql077 = readFileSync("supabase/migrations/077_step_local_workflow_execution.sql", "utf8");
const sql073 = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");
const sql074 = readFileSync("supabase/migrations/074_workflow_step_deadlines.sql", "utf8");
const sql075 = readFileSync("supabase/migrations/075_ai_intelligence_platform.sql", "utf8");
const sql076 = readFileSync("supabase/migrations/076_project_workflow_step_responsibility.sql", "utf8");
const sql014 = readFileSync("supabase/migrations/014_assignee_enforcement.sql", "utf8");
const platformSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
const loaderSrc = readFileSync("src/server/use-cases/project-workflow.ts", "utf8");
const detailsSrc = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const workerSrc = readFileSync("src/server/services/notification-delivery-worker.ts", "utf8");

const predicateSql = sql077.split("create or replace function public.apply_workflow_step_outcome")[0] ?? "";

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function facts(overrides: Partial<WorkflowStepExecutionFacts> = {}): WorkflowStepExecutionFacts {
  return {
    authUserId: USER_A,
    instanceExists: true,
    stepExists: true,
    stepBelongsToInstance: true,
    profileActive: true,
    orgMembershipActive: true,
    organizationMatches: true,
    entityType: "project",
    canAccessProject: true,
    isActiveProjectParticipant: true,
    hasEmployeeRow: true,
    employeeActive: true,
    stepStatus: "ready",
    instanceStatus: "in_progress",
    responsibleUserId: USER_A,
    hasWorkflowManage: false,
    hasWorkflowAdvance: false,
    canActOnWorkflowStep: false,
    ...overrides,
  };
}

describe("077 step-local responsible execution", () => {
  it("CASE 01 responsible + READY own step → can execute", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "ready" }))).toBe(true);
    expect(canExecuteWorkflowInstanceStep(facts({ stepStatus: "ready" }))).toBe(true);
  });

  it("CASE 02 responsible + IN_PROGRESS own step → can execute", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "in_progress" }))).toBe(true);
  });

  it("CASE 03 responsible cannot execute another step in the same project", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ responsibleUserId: USER_B }))).toBe(false);
  });

  it("CASE 04 / 33 project A responsibility cannot act on project B", () => {
    expect(
      canExecuteAsStepLocalResponsible(
        facts({ canAccessProject: false, isActiveProjectParticipant: false }),
      ),
    ).toBe(false);
  });

  it("CASE 05 cross-tenant step UUID → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ organizationMatches: false }))).toBe(false);
    expect(canExecuteAsStepLocalResponsible(facts({ orgMembershipActive: false }))).toBe(false);
  });

  it("CASE 06 responsible removed from project → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ isActiveProjectParticipant: false }))).toBe(false);
  });

  it("CASE 07 inactive organization membership → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ orgMembershipActive: false }))).toBe(false);
  });

  it("CASE 08 inactive profile → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ profileActive: false }))).toBe(false);
  });

  it("CASE 09 existing employee becomes inactive → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ hasEmployeeRow: true, employeeActive: false }))).toBe(false);
  });

  it("CASE 10 no employee row + active profile/member/project access → allow", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ hasEmployeeRow: false, employeeActive: false }))).toBe(true);
  });

  it("CASE 11 completed step → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "completed" }))).toBe(false);
  });

  it("CASE 12 cancelled step → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "cancelled" }))).toBe(false);
  });

  it("CASE 13 rejected step → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "rejected" }))).toBe(false);
  });

  it("CASE 14 skipped step → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "skipped" }))).toBe(false);
  });

  it("CASE 15 pending / not-yet-active step → deny", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ stepStatus: "pending" }))).toBe(false);
  });

  it("CASE 16 responsible may call completion RPC for own actionable step", () => {
    expect(sql077).toMatch(/create or replace function public\.apply_workflow_step_outcome/);
    expect(sql077).toMatch(/can_execute_workflow_instance_step\(p_instance_step_id\)/);
    expect(sql073).toMatch(/return public\.apply_workflow_step_outcome\(p_instance_step_id, p_outcome, 'direct'\)/);
    expect(sql077).not.toMatch(/create or replace function public\.complete_workflow_step/);
  });

  it("CASE 17 deadline update still requires workflow.manage", () => {
    expect(sql077).not.toMatch(/create or replace function public\.update_workflow_step_deadline/);
    expect(sql074).toMatch(/if not public\.has_permission\('workflow\.manage'/);
    expect(sql074).not.toMatch(/responsible_user_id/);
  });

  it("CASE 18 reassignment still requires workflow.manage", () => {
    expect(sql077).not.toMatch(/create or replace function public\.assign_workflow_step_responsible/);
    expect(sql076).toMatch(/has_permission\('workflow\.manage'/);
    expect(platformSrc).toMatch(/authorize\(await getAuthContext\(\), WORKFLOW_ASSIGN_PERMISSION\)/);
  });

  it("CASE 19 workflow start is independently authorized", () => {
    expect(sql077).not.toMatch(/create or replace function public\.start_workflow/);
    const start = platformSrc.slice(
      platformSrc.indexOf("export async function startWorkflowAction"),
      platformSrc.indexOf("export async function updateWorkflowStepDeadlineAction"),
    );
    expect(start).toContain('authorize(await getAuthContext(), "workflow.start")');
  });

  it("CASE 20 approval decision is not granted by responsibility", () => {
    expect(sql077).not.toMatch(/create or replace function public\.can_act_on_approval_step/);
    expect(sql077).not.toMatch(/create or replace function public\.submit_approval_decision/);
    expect(sql014).not.toMatch(/responsible_user_id/);
  });

  it("CASE 21 requires_approval without valid A/B still WORKFLOW_GATE_REQUIRED", () => {
    const apply = sql077.split("create or replace function public.apply_workflow_step_outcome")[1] ?? "";
    expect(apply).toMatch(/p_source = 'direct'/);
    expect(apply).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(apply).toMatch(/official_code in \('A', 'B'\)/);
  });

  it("CASE 22–26 preserve 073 A/B complete, C resubmit, D reject, E no movement", () => {
    expect(sql073).toMatch(/when 'A' then 'complete'/);
    expect(sql073).toMatch(/when 'B' then 'complete'/);
    expect(sql073).toMatch(/when 'C' then 'resubmit'/);
    expect(sql073).toMatch(/when 'D' then 'reject'/);
    expect(sql073).toMatch(/else null/);
    expect(sql077).not.toMatch(/when 'A' then/);
    expect(sql077).toMatch(/p_source = 'approval_gate'/);
    expect(sql077).not.toMatch(/create or replace function public\.submit_approval_decision/);
  });

  it("CASE 27 existing workflow.manage path is unchanged", () => {
    expect(existingWorkflowExecutionPath(facts({
      responsibleUserId: USER_B,
      hasWorkflowManage: true,
      hasWorkflowAdvance: false,
      canActOnWorkflowStep: false,
    }))).toBe(true);
    expect(sql077).toMatch(/has_permission\('workflow\.manage'/);
  });

  it("CASE 28–30 existing workflow.advance + assigned user/role/department unchanged", () => {
    expect(sql077).not.toMatch(/create or replace function public\.can_act_on_workflow_step/);
    expect(sql014).toMatch(/s\.assigned_user_id = auth\.uid\(\)/);
    expect(sql014).toMatch(/s\.assigned_role_id/);
    expect(sql014).toMatch(/s\.assigned_department_id/);
    expect(
      existingWorkflowExecutionPath(
        facts({
          responsibleUserId: null,
          hasWorkflowAdvance: true,
          canActOnWorkflowStep: true,
        }),
      ),
    ).toBe(true);
  });

  it("CASE 31–32 assignment grants no role or permission rows", () => {
    expect(sql077).not.toMatch(/insert into public\.user_roles/);
    expect(sql077).not.toMatch(/insert into public\.role_permissions/);
    expect(sql077).not.toMatch(/insert into public\.project_members/);
    expect(canExecuteAsStepLocalResponsible(facts({
      hasWorkflowManage: false,
      hasWorkflowAdvance: false,
      canActOnWorkflowStep: false,
    }))).toBe(true);
  });

  it("CASE 34 reassignment A → B transfers step-local execution immediately", () => {
    expect(canExecuteAsStepLocalResponsible(facts({ authUserId: USER_A, responsibleUserId: USER_B }))).toBe(false);
    expect(canExecuteAsStepLocalResponsible(facts({ authUserId: USER_B, responsibleUserId: USER_B }))).toBe(true);
    expect(sql076).toMatch(/set responsible_user_id = p_responsible_user_id/);
  });

  it("CASE 35 076 start_workflow overlay is unchanged", () => {
    expect(sql076).toMatch(/from public\.project_workflow_step_assignments/);
    expect(sql077).not.toMatch(/project_workflow_step_assignments/);
    expect(sql077).not.toMatch(/create or replace function public\.start_workflow/);
  });

  it("CASE 36 074 SLA trigger is unchanged", () => {
    expect(sql074).toMatch(/new\.warning_at := new\.due_at - make_interval\(hours => v_warn\)/);
    expect(sql077).not.toMatch(/warning_at/);
    expect(sql077).not.toMatch(/sla_hours/);
  });

  it("CASE 37 READY activation notification/email is unchanged", () => {
    expect(workerSrc).toMatch(/type: "workflow\.step\.activated"/);
    expect(predicateSql).not.toMatch(/workflow\.step\.activated/);
    expect(predicateSql).not.toMatch(/notifyWorkflowReadyAssignees/);
  });

  it("CASE 38 authorization check does not emit notifications", () => {
    expect(predicateSql).not.toMatch(/emit_domain_event/);
    expect(predicateSql).not.toMatch(/log_audit/);
    expect(predicateSql).not.toMatch(/insert into public\.notifications/);
  });
});

describe("077 SQL safety and frozen-file regression", () => {
  it("does not rewrite frozen 073–076 files or 014 assignee predicates", () => {
    expect(sql073).not.toMatch(/can_execute_workflow_instance_step/);
    expect(sql074).not.toMatch(/can_execute_workflow_instance_step/);
    expect(sql075).not.toMatch(/can_execute_workflow_instance_step/);
    expect(sql076).not.toMatch(/can_execute_workflow_instance_step/);
    expect(sql014).not.toMatch(/responsible_user_id/);
    expect(sql077).not.toMatch(/create or replace function public\.can_act_on_workflow_step/);
    expect(sql077).not.toMatch(/create or replace function public\.can_act_on_approval_step/);
  });

  it("is additive CREATE OR REPLACE with controlled grants", () => {
    expect(sql077).toMatch(/create or replace function public\.can_execute_workflow_instance_step/);
    expect(sql077).toMatch(/security definer/);
    expect(sql077).toMatch(/set search_path = public/);
    expect(sql077).toMatch(/revoke all on function public\.can_execute_workflow_instance_step\(uuid\)\s+from public, anon, service_role/);
    expect(sql077).toMatch(/grant execute on function public\.can_execute_workflow_instance_step\(uuid\) to authenticated/);
    expect(sql077).toMatch(/revoke all on function public\.apply_workflow_step_outcome\(uuid, text, text\)\s+from public, anon, authenticated, service_role/);
    expect(sql077).not.toMatch(/grant execute on function public\.apply_workflow_step_outcome/);
    expect(sql077).not.toMatch(/grant execute on function public\.can_execute_workflow_instance_step\(uuid\) to anon/);
    expect(sql077).not.toMatch(/grant execute on function public\.can_execute_workflow_instance_step\(uuid\) to public/);
  });

  it("has no destructive DDL", () => {
    expect(sql077).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|TYPE|SCHEMA)\b/i);
    expect(sql077).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql077).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql077).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql077).not.toMatch(/\bCREATE\s+ROLE\b/i);
    expect(sql077).not.toMatch(/\bALTER\s+ROLE\b/i);
    expect(sql077).not.toMatch(/\bALTER\s+DATABASE\b/i);
  });

  it("keeps 076 SHA-256 frozen", () => {
    const sha = createHash("sha256").update(readFileSync("supabase/migrations/076_project_workflow_step_responsibility.sql")).digest("hex");
    expect(sha).toBe("e0b6f27a7f7daee1e4a78d09c06bf98a71b7a4759042887fd6a70a1fa1753514");
  });
});

describe("application gates and UI", () => {
  it("completeWorkflowStepAction no longer uses workflow.advance as the sole gate", () => {
    const completeFn = platformSrc.slice(
      platformSrc.indexOf("export async function completeWorkflowStepAction"),
      platformSrc.indexOf("export async function createApprovalAction"),
    );
    expect(completeFn).toMatch(/requireUser\(await getAuthContext\(\)\)/);
    expect(completeFn).not.toMatch(/authorize\(await getAuthContext\(\), "workflow\.advance"\)/);
    expect(completeFn).toMatch(/complete_workflow_step/);
    expect(completeFn).toMatch(/throwMappedWorkflowRpc/);
  });

  it("UI canComplete uses the step-local execution RPC and keeps display split", () => {
    expect(loaderSrc).toMatch(/can_execute_workflow_instance_step/);
    expect(loaderSrc).toMatch(/resolveWorkflowStepExecutionLookup/);
    expect(loaderSrc).toMatch(/shouldCallLegacyCanAct/);
    expect(loaderSrc).toMatch(/deriveWorkflowStepActions/);
    expect(loaderSrc).toMatch(/requiredRoleLabel: assignment\.requiredRoleLabel/);
    expect(loaderSrc).toMatch(/canEditDeadline: Boolean\(isActive && canManage/);
    expect(loaderSrc).toMatch(/canAssignResponsible: Boolean\(canManage && canReassignWorkflowStepStatus/);
    expect(detailsSrc).toMatch(/إكمال المرحلة/);
    expect(detailsSrc).toMatch(/node\.canComplete/);
  });

  it("does not collapse execute / submit approval / decide approval", () => {
    const ismailActive = deriveWorkflowStepActions({
      isActive: true,
      canExecuteStep: true,
      canCreateApproval: false,
      canDecideThisApproval: false,
      requiresApproval: false,
      openApproval: null,
      latestOfficialCode: null,
    });
    expect(ismailActive.canComplete).toBe(true);
    expect(ismailActive.canSubmitApproval).toBe(false);
    expect(ismailActive.canDecideApproval).toBe(false);

    const approvalStage = deriveWorkflowStepActions({
      isActive: true,
      canExecuteStep: true,
      canCreateApproval: true,
      canDecideThisApproval: false,
      requiresApproval: true,
      openApproval: null,
      latestOfficialCode: null,
    });
    expect(approvalStage.canComplete).toBe(false);
    expect(approvalStage.canSubmitApproval).toBe(true);
    expect(approvalStage.canDecideApproval).toBe(false);

    const otherStep = deriveWorkflowStepActions({
      isActive: false,
      canExecuteStep: true,
      canCreateApproval: true,
      canDecideThisApproval: false,
      requiresApproval: false,
      openApproval: null,
      latestOfficialCode: null,
    });
    expect(otherStep.canComplete).toBe(false);
  });
});

const missingRpc = {
  code: "PGRST202",
  message: "Could not find the function public.can_execute_workflow_instance_step without parameters in the schema cache",
  details:
    "Searched for the function public.can_execute_workflow_instance_step with parameter p_instance_step_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  hint: null,
};

describe("077 application fallback (F1–F20)", () => {
  it("CASE F1 can_execute succeeds true → no legacy fallback", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: true,
      executeError: null,
      legacyCanAct: false,
    });
    expect(result).toMatchObject({ canExecute: true, usedLegacyFallback: false, failedClosed: false, shouldCallLegacyCanAct: false });
  });

  it("CASE F2 can_execute succeeds false → no legacy fallback", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: false,
      executeError: null,
      legacyCanAct: true,
    });
    expect(result).toMatchObject({ canExecute: false, usedLegacyFallback: false, shouldCallLegacyCanAct: false });
  });

  it("CASE F3 verified missing-RPC for can_execute_workflow_instance_step → legacy allowed", () => {
    expect(isMissingWorkflowExecutionRpcError(missingRpc)).toBe(true);
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: missingRpc,
      legacyCanAct: null,
    });
    expect(result.shouldCallLegacyCanAct).toBe(true);
    expect(result.failedClosed).toBe(false);
  });

  it("CASE F4 missing-RPC + legacy can_act true → true", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: missingRpc,
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(true);
    expect(result.shouldCallLegacyCanAct).toBe(true);
  });

  it("CASE F5 missing-RPC + legacy can_act false → false", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: missingRpc,
      legacyCanAct: false,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(true);
  });

  it("CASE F6 permission denied → fail closed, legacy not called", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { code: "42501", message: "permission denied for function can_execute_workflow_instance_step" },
      legacyCanAct: true,
    });
    expect(result).toMatchObject({ canExecute: false, failedClosed: true, shouldCallLegacyCanAct: false, usedLegacyFallback: false });
    expect(
      isMissingWorkflowExecutionRpcError({
        code: "42501",
        message: "permission denied for function can_execute_workflow_instance_step",
      }),
    ).toBe(false);
  });

  it("CASE F7 insufficient privilege → fail closed", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { code: "42501", message: "insufficient privilege" },
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(false);
  });

  it("CASE F8 SQL/internal database error → fail closed", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { code: "XX000", message: "internal error" },
      legacyCanAct: true,
    });
    expect(result).toMatchObject({ canExecute: false, failedClosed: true, shouldCallLegacyCanAct: false });
  });

  it("CASE F9 network error → fail closed", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { message: "Failed to fetch", code: "NETWORK" },
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(false);
  });

  it("CASE F10 timeout → fail closed", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { code: "57014", message: "canceling statement due to statement timeout" },
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(false);
  });

  it("CASE F11 malformed/unexpected error object → fail closed", () => {
    expect(isMissingWorkflowExecutionRpcError("boom")).toBe(false);
    expect(isMissingWorkflowExecutionRpcError(null)).toBe(false);
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { foo: "bar" },
      legacyCanAct: true,
    });
    expect(result).toMatchObject({ canExecute: false, failedClosed: true, shouldCallLegacyCanAct: false });
  });

  it("CASE F12 PostgREST not-found for another function → fail closed", () => {
    const error = {
      code: "PGRST202",
      message: "Could not find the function public.can_act_on_workflow_step without parameters in the schema cache",
      details: "Searched for the function public.can_act_on_workflow_step with parameter p_step_id",
      hint: "Perhaps you meant to call the function public.can_execute_workflow_instance_step",
    };
    expect(isMissingWorkflowExecutionRpcError(error)).toBe(false);
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: error,
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(false);
  });

  it("CASE F13 generic message containing function → fail closed", () => {
    expect(
      isMissingWorkflowExecutionRpcError({ message: "function failed" }),
    ).toBe(false);
  });

  it("CASE F14 generic message containing not found → fail closed", () => {
    expect(
      isMissingWorkflowExecutionRpcError({ message: "not found", code: "PGRST116" }),
    ).toBe(false);
  });

  it("CASE F15 function-name appears but code is not missing-RPC → fail closed", () => {
    expect(
      isMissingWorkflowExecutionRpcError({
        code: "42501",
        message: "Could not find the function public.can_execute_workflow_instance_step in the schema cache",
      }),
    ).toBe(false);
  });

  it("CASE F16 expected missing-RPC code but wrong function name → fail closed", () => {
    expect(
      isMissingWorkflowExecutionRpcError({
        code: "PGRST202",
        message: "Could not find the function public.complete_workflow_step in the schema cache",
        details: "Searched for the function public.complete_workflow_step",
      }),
    ).toBe(false);
  });

  it("CASE F17 workflow.manage existing path remains valid", () => {
    const missing = resolveWorkflowStepExecutionLookup({
      canManage: true,
      canAdvance: true,
      executeOk: null,
      executeError: missingRpc,
      legacyCanAct: false,
    });
    expect(missing).toMatchObject({ canExecute: true, shouldCallLegacyCanAct: false, usedLegacyFallback: true });
    const after077 = resolveWorkflowStepExecutionLookup({
      canManage: true,
      canAdvance: true,
      executeOk: true,
      executeError: null,
      legacyCanAct: false,
    });
    expect(after077.canExecute).toBe(true);
    expect(after077.shouldCallLegacyCanAct).toBe(false);
  });

  it("CASE F18 responsible-user after simulated 077 true → canComplete true", () => {
    const lookup = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: false,
      executeOk: true,
      executeError: null,
      legacyCanAct: false,
    });
    expect(lookup.canExecute).toBe(true);
    expect(
      deriveWorkflowStepActions({
        isActive: true,
        canExecuteStep: lookup.canExecute,
        canCreateApproval: false,
        canDecideThisApproval: false,
        requiresApproval: false,
        openApproval: null,
        latestOfficialCode: null,
      }).canComplete,
    ).toBe(true);
  });

  it("CASE F19 non-responsible after simulated 077 false → canComplete false", () => {
    const lookup = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: false,
      executeError: null,
      legacyCanAct: true,
    });
    expect(lookup.canExecute).toBe(false);
    expect(lookup.shouldCallLegacyCanAct).toBe(false);
    expect(
      deriveWorkflowStepActions({
        isActive: true,
        canExecuteStep: lookup.canExecute,
        canCreateApproval: false,
        canDecideThisApproval: false,
        requiresApproval: false,
        openApproval: null,
        latestOfficialCode: null,
      }).canComplete,
    ).toBe(false);
  });

  it("CASE F20 DB execution error cannot make unauthorized button appear", () => {
    const result = resolveWorkflowStepExecutionLookup({
      canManage: false,
      canAdvance: true,
      executeOk: null,
      executeError: { code: "XX000", message: "function can_execute_workflow_instance_step crashed" },
      legacyCanAct: true,
    });
    expect(result.canExecute).toBe(false);
    expect(result.shouldCallLegacyCanAct).toBe(false);
    expect(
      deriveWorkflowStepActions({
        isActive: true,
        canExecuteStep: result.canExecute,
        canCreateApproval: true,
        canDecideThisApproval: false,
        requiresApproval: false,
        openApproval: null,
        latestOfficialCode: null,
      }).canComplete,
    ).toBe(false);
  });

  it("also accepts Postgres 42883 missing-function for this RPC only", () => {
    expect(
      isMissingWorkflowExecutionRpcError({
        code: "42883",
        message: "function public.can_execute_workflow_instance_step(uuid) does not exist",
      }),
    ).toBe(true);
  });
});

