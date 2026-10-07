import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import { PROCUREMENT_STEP_KEY } from "@/modules/procurement/stage05-readiness";
import {
  evaluateMobilizationReady,
  MOBILIZATION_ITEM_KEYS,
  MOBILIZATION_ITEM_LABELS,
  MOBILIZATION_STEP_KEY,
  parseMobilizationReadiness,
} from "./stage06-mobilization";

const sql081 = readFileSync("supabase/migrations/081_project_mobilization_readiness.sql", "utf8");
const sql080 = readFileSync("supabase/migrations/080_workflow_procurement_completion_gate.sql", "utf8");
const details = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const card = readFileSync("src/components/projects/mobilization-readiness-card.tsx", "utf8");
const gate = readFileSync("src/modules/projects/approval-workflow-gate.ts", "utf8");
const employee = readFileSync("src/lib/permissions/catalog.ts", "utf8");

describe("Stage 06 mobilization readiness (MOB-DB / MOB-APP)", () => {
  it("MOB-DB-1 MOB-DB-2 MOB-DB-3: incomplete packages are not ready", () => {
    expect(evaluateMobilizationReady({ required_count: 0, confirmed_required_count: 0 })).toBe(false);
    expect(evaluateMobilizationReady({ required_count: 6, confirmed_required_count: 0 })).toBe(false);
    expect(evaluateMobilizationReady({ required_count: 6, confirmed_required_count: 5 })).toBe(false);
  });

  it("MOB-DB-4: 6/6 is ready", () => {
    expect(evaluateMobilizationReady({ required_count: 6, confirmed_required_count: 6 })).toBe(true);
    expect(MOBILIZATION_ITEM_KEYS).toHaveLength(6);
  });

  it("MOB-DB-5: set item does not complete the workflow step", () => {
    const setter =
      sql081.split("create or replace function public.set_project_mobilization_readiness_item")[1]?.split(
        "create or replace function public.apply_workflow_step_outcome",
      )[0] ?? "";
    expect(setter).not.toMatch(/status = 'completed'/);
    expect(setter).not.toMatch(/complete_workflow_step/);
  });

  it("MOB-DB-6: mutation requires can_execute_workflow_instance_step", () => {
    expect(sql081).toMatch(/can_execute_workflow_instance_step\(v_step\)/);
  });

  it("MOB-DB-7 MOB-DB-8 MOB-DB-9: access is project-scoped", () => {
    expect(sql081).toMatch(/if not public.can_access_project\(p_project_id\) then/);
    expect(sql081).toMatch(/using \(public.can_access_project\(project_id\)\)/);
  });

  it("MOB-DB-10: invalid item keys are rejected", () => {
    expect(sql081).toMatch(/raise exception 'VALIDATION'/);
    expect(sql081).toMatch(/p_item_key not in/);
  });

  it("MOB-DB-11: client cannot write confirmed_by", () => {
    expect(sql081).toMatch(/revoke insert, update, delete on public.project_mobilization_readiness_items/);
    expect(sql081).toMatch(/confirmed_by = case when p_is_confirmed then v_uid else null end/);
  });

  it("MOB-DB-12: package and items are unique", () => {
    expect(sql081).toMatch(/project_id uuid not null unique/);
    expect(sql081).toMatch(/unique \(readiness_id, item_key\)/);
    expect(sql081).toMatch(/on conflict \(readiness_id, item_key\) do nothing/);
  });

  it("MOB-DB-13: unconfirm clears confirmation fields", () => {
    expect(sql081).toMatch(/confirmed_at = case when p_is_confirmed then timezone\('utc', now\(\)\) else null end/);
  });

  it("MOB-DB-14: private helpers are revoked from clients", () => {
    expect(sql081).toMatch(/revoke all on function public.project_has_mobilization_completion_package/);
    expect(sql081).toMatch(/revoke all on function public.ensure_project_mobilization_readiness/);
  });

  it("MOB-DB-15 MOB-DB-16: other steps and approval gates remain", () => {
    expect(sql081).toMatch(/v_step.step_key = 'procurement'/);
    expect(sql081).toMatch(/WORKFLOW_PROCUREMENT_NOT_READY/);
    expect(sql081).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql080).toMatch(/WORKFLOW_PROCUREMENT_NOT_READY/);
  });

  it("MOB-APP-1 MOB-APP-2: Stage 06 card and Arabic labels", () => {
    expect(details).toMatch(/MobilizationReadinessCard/);
    expect(card).toMatch(/حالة التجهيز/);
    expect(MOBILIZATION_ITEM_LABELS.site_ready).toContain("الموقع");
    expect(MOBILIZATION_ITEM_LABELS.procurement_coordination_ready).toContain("تنسيق");
  });

  it("MOB-APP-3 MOB-APP-4: parse 0/6 and progress", () => {
    const empty = parseMobilizationReadiness({
      ready: false,
      required_count: 6,
      confirmed_required_count: 0,
      items: MOBILIZATION_ITEM_KEYS.map((item_key) => ({ item_key, is_required: true, is_confirmed: false })),
    });
    expect(empty?.confirmed_required_count).toBe(0);
    expect(empty?.ready).toBe(false);
    expect(empty?.items).toHaveLength(6);
  });

  it("MOB-APP-7 MOB-APP-8: complete button uses mobilization readiness", () => {
    expect(details).toMatch(/MOBILIZATION_STEP_KEY && mobilizationReadiness\?\.ready === false/);
    expect(details).toMatch(/PROCUREMENT_STEP_KEY && procurementReadiness\?\.ready === false/);
  });

  it("MOB-APP-9: maps a stable Arabic error", () => {
    const mapped = mapWorkflowRpcError("WORKFLOW_MOBILIZATION_NOT_READY");
    expect(mapped.kind).toBe("VALIDATION");
    expect(mapped.ar).toBe("يجب إكمال عناصر التجهيز المطلوبة قبل إكمال المرحلة.");
    expect(gate).toMatch(/WORKFLOW_MOBILIZATION_NOT_READY/);
  });

  it("MOB-APP-11 MOB-APP-12: no procurement/approval regressions and no employee widening", () => {
    expect(details).toMatch(/ProcurementReadinessCard/);
    expect(PROCUREMENT_STEP_KEY).toBe("procurement");
    expect(MOBILIZATION_STEP_KEY).toBe("mobilization");
    expect(employee).not.toMatch(/grant Ali project_manager/);
    expect(sql081).not.toMatch(/insert into public.role_permissions/);
    expect(sql081).not.toMatch(/openai/i);
    expect(sql081).not.toMatch(/whatsapp/i);
  });
});
