import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { whatsappAudienceFor } from "@/modules/notifications/whatsapp-policy";
import {
  evaluateHandoverReady,
  HANDOVER_ITEM_KEYS,
  HANDOVER_ITEM_LABELS,
  HANDOVER_STEP_KEY,
  parseHandoverReadiness,
} from "./stage09-handover";

const sql083 = readFileSync("supabase/migrations/083_final_workflow_evidence_gates.sql", "utf8");
const details = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const card = readFileSync("src/components/projects/handover-readiness-card.tsx", "utf8");
const gate = readFileSync("src/modules/projects/approval-workflow-gate.ts", "utf8");
const platform = readFileSync("src/server/use-cases/platform.ts", "utf8");

const apply083 =
  sql083.split("create or replace function public.apply_workflow_step_outcome")[1] ?? "";
const setter =
  sql083.split("create or replace function public.set_project_handover_item")[1]?.split(
    "create or replace function public.apply_workflow_step_outcome",
  )[0] ?? "";
const emit =
  setter.split("perform public.emit_domain_event")[1]?.split("return public.get_project_handover_readiness")[0] ?? "";

describe("Stage 09 handover (H1–H13 / APP)", () => {
  it("H1: ensure binds only to current handover ready/in_progress step", () => {
    expect(sql083).toMatch(/s\.step_key = 'handover'/);
    expect(HANDOVER_STEP_KEY).toBe("handover");
  });

  it("H2: exactly five canonical items", () => {
    expect(HANDOVER_ITEM_KEYS).toHaveLength(5);
    expect(sql083).toMatch(/'works_delivered'/);
    expect(sql083).toMatch(/'receipt_confirmed'/);
    expect(HANDOVER_ITEM_LABELS.works_delivered).toContain("تسليم الأعمال");
  });

  it("H3 H4 H13: unauthorized, cross-project, RLS/grants", () => {
    expect(sql083).toMatch(/revoke insert, update, delete on public\.project_handover_packages/);
    expect(sql083).toMatch(/revoke insert, update, delete on public\.project_handover_items/);
    expect(sql083).toMatch(/revoke all on function public\.ensure_project_handover_package/);
    expect(sql083).toMatch(/revoke all on function public\.project_has_handover_completion_package/);
    expect(sql083).toMatch(/grant execute on function public\.get_project_handover_readiness\(uuid\) to authenticated/);
    expect(sql083).toMatch(/grant execute on function public\.set_project_handover_item\(uuid, text, boolean, text\) to authenticated/);
  });

  it("H5: invalid key rejected", () => {
    expect(setter).toMatch(/p_item_key not in/);
  });

  it("H6 H7 H8: 0/5 and 4/5 block; 5/5 helper true", () => {
    expect(evaluateHandoverReady({ required_count: 5, confirmed_required_count: 0 })).toBe(false);
    expect(evaluateHandoverReady({ required_count: 5, confirmed_required_count: 4 })).toBe(false);
    expect(evaluateHandoverReady({ required_count: 5, confirmed_required_count: 5 })).toBe(true);
    expect(sql083).toMatch(/it\.is_required/);
    expect(sql083).toMatch(/it\.is_confirmed/);
    expect(sql083).toMatch(/\) = 5/);
  });

  it("H9: direct complete of handover is gated", () => {
    expect(apply083).toMatch(/v_step\.step_key = 'handover'/);
    expect(apply083).toMatch(/project_has_handover_completion_package/);
    expect(apply083).toMatch(/WORKFLOW_HANDOVER_NOT_READY/);
  });

  it("H10: post-completion mutation is CONFLICT", () => {
    expect(setter).toMatch(/raise exception 'CONFLICT'/);
    expect(setter).not.toMatch(/complete_workflow_step/);
  });

  it("H11: duplicate prevention", () => {
    expect(sql083).toMatch(/on conflict \(project_id\) do nothing/);
    expect(sql083).toMatch(/on conflict \(package_id, item_key\) do nothing/);
  });

  it("H12: actor/timestamp derived", () => {
    expect(setter).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(setter).toMatch(/confirmed_by = case when p_is_confirmed then v_uid else null end/);
    expect(setter).not.toMatch(/p_confirmed_by/);
  });

  it("APP: card, hint, documents, complete disabled", () => {
    expect(details).toMatch(/HandoverReadinessCard/);
    expect(card).toMatch(/التسليم/);
    expect(card).toMatch(/تأكيد/);
    expect(card).toMatch(/مستندات المشروع/);
    expect(details).toMatch(/HANDOVER_STEP_KEY && handoverReadiness\?\.ready === false/);
    const empty = parseHandoverReadiness({
      ready: false,
      required_count: 5,
      confirmed_required_count: 0,
      items: HANDOVER_ITEM_KEYS.map((item_key) => ({
        item_key,
        is_required: true,
        is_confirmed: false,
      })),
    });
    expect(empty?.items).toHaveLength(5);
    expect(empty?.ready).toBe(false);
    const mapped = mapWorkflowRpcError("WORKFLOW_HANDOVER_NOT_READY");
    expect(mapped.ar).toBe("يجب إكمال جميع متطلبات التسليم قبل إكمال المرحلة.");
    expect(gate).toMatch(/WORKFLOW_HANDOVER_NOT_READY/);
    expect(emailAudienceFor("workflow.handover.item_updated")).toBe("none");
    expect(whatsappAudienceFor("workflow.handover.item_updated")).toBe("none");
    expect(emit).toMatch(/'old_confirmed'/);
    expect(emit).toMatch(/'new_confirmed'/);
    expect(emit).not.toMatch(/'note'/);
    expect(platform).toMatch(/set_project_handover_item/);
    expect(sql083).not.toMatch(/insert into public\.role_permissions/);
    expect(sql083).toMatch(/or public\.can_execute_workflow_instance_step\(p_instance_step_id\)/);
  });
});
