import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { whatsappAudienceFor } from "@/modules/notifications/whatsapp-policy";
import {
  COMMISSIONING_ITEM_KEYS,
  COMMISSIONING_ITEM_LABELS,
  COMMISSIONING_STATUS_LABELS,
  COMMISSIONING_STEP_KEY,
  evaluateCommissioningReady,
  parseCommissioningProgress,
} from "./stage08-commissioning";

const sql083 = readFileSync("supabase/migrations/083_final_workflow_evidence_gates.sql", "utf8");
const sql082 = readFileSync("supabase/migrations/082_project_execution_control.sql", "utf8");
const sql081 = readFileSync("supabase/migrations/081_project_mobilization_readiness.sql", "utf8");
const sql079 = readFileSync("supabase/migrations/079_workflow_gate_approval_documents.sql", "utf8");
const details = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const card = readFileSync("src/components/projects/commissioning-progress-card.tsx", "utf8");
const gate = readFileSync("src/modules/projects/approval-workflow-gate.ts", "utf8");
const employee = readFileSync("src/lib/permissions/catalog.ts", "utf8");
const platform = readFileSync("src/server/use-cases/platform.ts", "utf8");

const apply083 =
  sql083.split("create or replace function public.apply_workflow_step_outcome")[1] ?? "";
const setter =
  sql083.split("create or replace function public.set_project_commissioning_item")[1]?.split(
    "create or replace function public.ensure_project_handover_package",
  )[0] ?? "";
const emit =
  setter.split("perform public.emit_domain_event")[1]?.split("return public.get_project_commissioning_progress")[0] ??
  "";

describe("Stage 08 commissioning (C1–C14 / APP)", () => {
  it("C1: ensure binds only to current testing_commissioning ready/in_progress step", () => {
    expect(sql083).toMatch(/s\.step_key = 'testing_commissioning'/);
    expect(sql083).toMatch(/s\.status in \('ready', 'in_progress'\)/);
    expect(sql083).toMatch(/i\.status = 'in_progress'/);
    expect(COMMISSIONING_STEP_KEY).toBe("testing_commissioning");
  });

  it("C2: exactly six canonical items", () => {
    expect(COMMISSIONING_ITEM_KEYS).toHaveLength(6);
    expect(sql083).toMatch(/unique \(package_id, item_key\)/);
    expect(sql083).toMatch(/on conflict \(package_id, item_key\) do nothing/);
    expect(sql083).toMatch(/'electrical_lighting_test'/);
    expect(sql083).toMatch(/'final_observations_clearance'/);
  });

  it("C3 C4 C14: unauthorized and RLS/grants", () => {
    expect(sql083).toMatch(/if not public\.can_access_project\(p_project_id\) then/);
    expect(sql083).toMatch(/can_execute_workflow_instance_step\(v_step\)/);
    expect(sql083).toMatch(/using \(public\.can_access_project\(project_id\)\)/);
    expect(sql083).toMatch(/revoke insert, update, delete on public\.project_commissioning_packages/);
    expect(sql083).toMatch(/revoke insert, update, delete on public\.project_commissioning_items/);
    expect(sql083).toMatch(/revoke all on function public\.ensure_project_commissioning_package/);
    expect(sql083).toMatch(/revoke all on function public\.project_has_commissioning_completion_package/);
    expect(sql083).toMatch(/grant execute on function public\.get_project_commissioning_progress\(uuid\) to authenticated/);
    expect(sql083).toMatch(/grant execute on function public\.set_project_commissioning_item\(uuid, text, text, text\) to authenticated/);
  });

  it("C5: invalid key rejected", () => {
    expect(setter).toMatch(/p_item_key not in/);
  });

  it("C6 C7 C8 C9: pending/failed/5-of-6 block; 6/6 helper true", () => {
    expect(evaluateCommissioningReady({ required_count: 6, passed_count: 0 })).toBe(false);
    expect(evaluateCommissioningReady({ required_count: 6, passed_count: 5 })).toBe(false);
    expect(evaluateCommissioningReady({ required_count: 6, passed_count: 6 })).toBe(true);
    expect(sql083).toMatch(/it\.status in \('pending', 'failed'\)/);
    expect(sql083).toMatch(/it\.status = 'passed'/);
    expect(sql083).toMatch(/\) = 6/);
  });

  it("C10: direct complete of testing_commissioning is gated", () => {
    expect(apply083).toMatch(/v_step\.step_key = 'testing_commissioning'/);
    expect(apply083).toMatch(/project_has_commissioning_completion_package/);
    expect(apply083).toMatch(/WORKFLOW_COMMISSIONING_NOT_READY/);
    expect(apply083).toMatch(/p_source = 'direct'/);
  });

  it("C11: post-completion mutation is CONFLICT", () => {
    expect(setter).toMatch(/raise exception 'CONFLICT'/);
    expect(setter).not.toMatch(/complete_workflow_step/);
  });

  it("C12: duplicate package/items prevented", () => {
    expect(sql083).toMatch(/project_id uuid not null unique/);
    expect(sql083).toMatch(/on conflict \(project_id\) do nothing/);
  });

  it("C13: actor/timestamps server-derived", () => {
    expect(setter).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(setter).toMatch(/updated_by = v_uid/);
    expect(setter).not.toMatch(/p_updated_by/);
    expect(setter).not.toMatch(/p_actor/);
  });

  it("APP: Arabic labels, card, documents link, complete disabled", () => {
    expect(details).toMatch(/CommissioningProgressCard/);
    expect(card).toMatch(/الاختبار والتشغيل/);
    expect(card).toMatch(/نتيجة الاختبار/);
    expect(card).toMatch(/حفظ/);
    expect(card).toMatch(/مستندات المشروع/);
    expect(COMMISSIONING_ITEM_LABELS.electrical_lighting_test).toContain("الكهرباء");
    expect(COMMISSIONING_STATUS_LABELS.pending).toBe("بانتظار الاختبار");
    expect(COMMISSIONING_STATUS_LABELS.passed).toBe("ناجح");
    expect(COMMISSIONING_STATUS_LABELS.failed).toBe("فشل الاختبار");
    expect(details).toMatch(/COMMISSIONING_STEP_KEY && commissioningProgress\?\.ready === false/);
  });

  it("APP: parse empty package and map error", () => {
    const empty = parseCommissioningProgress({
      ready: false,
      required_count: 6,
      passed_count: 0,
      items: COMMISSIONING_ITEM_KEYS.map((item_key) => ({
        item_key,
        is_required: true,
        status: "pending",
      })),
    });
    expect(empty?.passed_count).toBe(0);
    expect(empty?.ready).toBe(false);
    expect(empty?.items).toHaveLength(6);
    const mapped = mapWorkflowRpcError("WORKFLOW_COMMISSIONING_NOT_READY");
    expect(mapped.kind).toBe("VALIDATION");
    expect(mapped.ar).toBe("يجب اجتياز جميع اختبارات التشغيل قبل إكمال المرحلة.");
    expect(gate).toMatch(/WORKFLOW_COMMISSIONING_NOT_READY/);
  });

  it("APP: no email/whatsapp; event payload omits note", () => {
    expect(emailAudienceFor("workflow.commissioning.item_updated")).toBe("none");
    expect(whatsappAudienceFor("workflow.commissioning.item_updated")).toBe("none");
    expect(emit).toMatch(/'old_status'/);
    expect(emit).toMatch(/'new_status'/);
    expect(emit).not.toMatch(/'note'/);
    expect(employee).not.toMatch(/grant Ali project_manager/);
    expect(sql083).not.toMatch(/insert into public\.role_permissions/);
    expect(sql083).not.toMatch(/openai/i);
    expect(sql083).not.toMatch(/whatsapp/i);
    expect(sql083).not.toMatch(/drop table/i);
    expect(sql083).not.toMatch(/truncate /i);
    expect(platform).toMatch(/set_project_commissioning_item/);
  });

  it("REGRESSION: 079/081/082 gates remain; closeout unchanged", () => {
    expect(apply083).toMatch(/WORKFLOW_PROCUREMENT_NOT_READY/);
    expect(apply083).toMatch(/WORKFLOW_MOBILIZATION_NOT_READY/);
    expect(apply083).toMatch(/WORKFLOW_EXECUTION_NOT_READY/);
    expect(apply083).toMatch(/WORKFLOW_COMMISSIONING_NOT_READY/);
    expect(apply083).toMatch(/WORKFLOW_HANDOVER_NOT_READY/);
    expect(apply083).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql082).toMatch(/WORKFLOW_EXECUTION_NOT_READY/);
    expect(sql081).toMatch(/WORKFLOW_MOBILIZATION_NOT_READY/);
    expect(sql079).toMatch(/DOCUMENT_REQUIRED/);
    expect(sql079).toMatch(/create_current_workflow_gate_approval/);
    expect(sql083).not.toMatch(/closeout_packages/);
    expect(sql083).not.toMatch(/closeout_items/);
    expect(sql083).not.toMatch(/update public\.projects[\s\S]{0,80}status/);
    expect(details).toMatch(/ProcurementReadinessCard/);
    expect(details).toMatch(/MobilizationReadinessCard/);
    expect(details).toMatch(/ExecutionProgressCard/);
  });
});
