import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { whatsappAudienceFor } from "@/modules/notifications/whatsapp-policy";
import { PROCUREMENT_STEP_KEY } from "@/modules/procurement/stage05-readiness";
import { MOBILIZATION_STEP_KEY } from "@/modules/projects/stage06-mobilization";
import {
  deriveOverallProgress,
  evaluateExecutionReady,
  EXECUTION_ITEM_KEYS,
  EXECUTION_ITEM_LABELS,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STEP_KEY,
  isValidExecutionProgressCombo,
  parseExecutionProgress,
} from "./stage07-execution";

const sql082 = readFileSync("supabase/migrations/082_project_execution_control.sql", "utf8");
const sql081 = readFileSync("supabase/migrations/081_project_mobilization_readiness.sql", "utf8");
const details = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const card = readFileSync("src/components/projects/execution-progress-card.tsx", "utf8");
const gate = readFileSync("src/modules/projects/approval-workflow-gate.ts", "utf8");
const employee = readFileSync("src/lib/permissions/catalog.ts", "utf8");
const platform = readFileSync("src/server/use-cases/platform.ts", "utf8");

describe("Stage 07 execution control (E1–E20 / APP)", () => {
  it("E1: ensure binds only to current execution ready/in_progress step", () => {
    expect(sql082).toMatch(/s\.step_key = 'execution'/);
    expect(sql082).toMatch(/s\.status in \('ready', 'in_progress'\)/);
    expect(sql082).toMatch(/i\.status = 'in_progress'/);
  });

  it("E2: six canonical items exist exactly once", () => {
    expect(EXECUTION_ITEM_KEYS).toHaveLength(6);
    expect(sql082).toMatch(/unique \(package_id, item_key\)/);
    expect(sql082).toMatch(/on conflict \(package_id, item_key\) do nothing/);
    expect(sql082).toMatch(/'architectural_partitions'/);
    expect(sql082).toMatch(/'ff_and_e'/);
  });

  it("E3 E4 E18: mutation requires project access and step-local execute", () => {
    expect(sql082).toMatch(/if not public\.can_access_project\(p_project_id\) then/);
    expect(sql082).toMatch(/can_execute_workflow_instance_step\(v_step\)/);
    expect(sql082).toMatch(/using \(public\.can_access_project\(project_id\)\)/);
  });

  it("E5: actor and timestamps are server-derived", () => {
    expect(sql082).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(sql082).toMatch(/updated_by = v_uid/);
    expect(sql082).not.toMatch(/p_updated_by/);
    expect(sql082).not.toMatch(/p_actor/);
  });

  it("E6 E7 E8: invalid key and progress bounds rejected", () => {
    expect(sql082).toMatch(/p_item_key not in/);
    expect(sql082).toMatch(/p_progress_percent < 0 or p_progress_percent > 100/);
    expect(isValidExecutionProgressCombo("in_progress", -1)).toBe(false);
    expect(isValidExecutionProgressCombo("in_progress", 101)).toBe(false);
  });

  it("E9 E10: completed+<100 and in_progress+100 rejected", () => {
    expect(isValidExecutionProgressCombo("completed", 50)).toBe(false);
    expect(isValidExecutionProgressCombo("in_progress", 100)).toBe(false);
    expect(sql082).toMatch(/p_status = 'completed' and p_progress_percent <> 100/);
    expect(sql082).toMatch(/p_status = 'in_progress' and \(p_progress_percent < 1 or p_progress_percent > 99\)/);
  });

  it("E11 E12 E13 E14 E15: completion predicate", () => {
    expect(evaluateExecutionReady({ required_count: 0, completed_count: 0 })).toBe(false);
    expect(evaluateExecutionReady({ required_count: 6, completed_count: 0 })).toBe(false);
    expect(evaluateExecutionReady({ required_count: 6, completed_count: 5 })).toBe(false);
    expect(evaluateExecutionReady({ required_count: 6, completed_count: 6 })).toBe(true);
    expect(sql082).toMatch(/it\.status = 'completed'/);
    expect(sql082).toMatch(/it\.progress_percent = 100/);
    expect(sql082).toMatch(/it\.status = 'blocked'/);
    expect(deriveOverallProgress([
      { is_required: true, progress_percent: 40 },
      { is_required: true, progress_percent: 20 },
      { is_required: true, progress_percent: 0 },
      { is_required: true, progress_percent: 0 },
      { is_required: true, progress_percent: 0 },
      { is_required: true, progress_percent: 0 },
    ])).toBe(10);
  });

  it("E16: post-completion update is CONFLICT", () => {
    const setter =
      sql082.split("create or replace function public.set_project_execution_item")[1]?.split(
        "create or replace function public.apply_workflow_step_outcome",
      )[0] ?? "";
    expect(setter).toMatch(/raise exception 'CONFLICT'/);
    expect(setter).not.toMatch(/workflow_instance_steps[\s\S]{0,80}status = 'completed'/);
    expect(setter).not.toMatch(/complete_workflow_step/);
  });

  it("E17: duplicate package prevented", () => {
    expect(sql082).toMatch(/project_id uuid not null unique/);
    expect(sql082).toMatch(/on conflict \(project_id\) do nothing/);
  });

  it("E19: authenticated clients cannot mutate tables", () => {
    expect(sql082).toMatch(/revoke insert, update, delete on public\.project_execution_packages/);
    expect(sql082).toMatch(/revoke insert, update, delete on public\.project_execution_items/);
  });

  it("E20: helpers revoked; search_path fixed; apply not granted", () => {
    expect(sql082).toMatch(/revoke all on function public\.ensure_project_execution_package/);
    expect(sql082).toMatch(/revoke all on function public\.project_has_execution_completion_package/);
    expect(sql082).toMatch(/set search_path = public/);
    expect(sql082).toMatch(/revoke all on function public\.apply_workflow_step_outcome/);
  });

  it("APP: Arabic labels and card", () => {
    expect(details).toMatch(/ExecutionProgressCard/);
    expect(card).toMatch(/التقدم في التنفيذ/);
    expect(card).toMatch(/حفظ التحديث/);
    expect(EXECUTION_ITEM_LABELS.architectural_partitions).toContain("المعمارية");
    expect(EXECUTION_ITEM_LABELS.ff_and_e).toContain("الأثاث");
    expect(EXECUTION_STATUS_LABELS.blocked).toBe("متعثر");
  });

  it("APP: parse 0/6 and disable complete until ready", () => {
    const empty = parseExecutionProgress({
      ready: false,
      required_count: 6,
      completed_count: 0,
      overall_progress: 0,
      items: EXECUTION_ITEM_KEYS.map((item_key) => ({
        item_key,
        is_required: true,
        status: "not_started",
        progress_percent: 0,
      })),
    });
    expect(empty?.completed_count).toBe(0);
    expect(empty?.ready).toBe(false);
    expect(empty?.items).toHaveLength(6);
    expect(details).toMatch(/EXECUTION_STEP_KEY && executionProgress\?\.ready === false/);
  });

  it("APP: maps WORKFLOW_EXECUTION_NOT_READY", () => {
    const mapped = mapWorkflowRpcError("WORKFLOW_EXECUTION_NOT_READY");
    expect(mapped.kind).toBe("VALIDATION");
    expect(mapped.ar).toBe("يجب إكمال عناصر التنفيذ المطلوبة قبل إكمال المرحلة.");
    expect(gate).toMatch(/WORKFLOW_EXECUTION_NOT_READY/);
  });

  it("APP: no email/whatsapp for item updates; no employee widening", () => {
    expect(emailAudienceFor("workflow.execution.item_updated")).toBe("none");
    expect(whatsappAudienceFor("workflow.execution.item_updated")).toBe("none");
    expect(employee).not.toMatch(/grant Ali project_manager/);
    expect(sql082).not.toMatch(/insert into public\.role_permissions/);
    expect(sql082).not.toMatch(/openai/i);
    expect(sql082).not.toMatch(/whatsapp/i);
    expect(sql082).not.toMatch(/drop table/i);
    expect(sql082).not.toMatch(/truncate /i);
  });

  it("APP: prior gates remain; setter does not complete Stage 07", () => {
    expect(sql082).toMatch(/WORKFLOW_PROCUREMENT_NOT_READY/);
    expect(sql082).toMatch(/WORKFLOW_MOBILIZATION_NOT_READY/);
    expect(sql082).toMatch(/WORKFLOW_EXECUTION_NOT_READY/);
    expect(sql081).toMatch(/WORKFLOW_MOBILIZATION_NOT_READY/);
    expect(PROCUREMENT_STEP_KEY).toBe("procurement");
    expect(MOBILIZATION_STEP_KEY).toBe("mobilization");
    expect(EXECUTION_STEP_KEY).toBe("execution");
    expect(platform).toMatch(/set_project_execution_item/);
    expect(details).toMatch(/ProcurementReadinessCard/);
    expect(details).toMatch(/MobilizationReadinessCard/);
  });
});
