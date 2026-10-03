import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");

describe("073 static SQL invariants", () => {
  it("extracts internal apply_workflow_step_outcome and does not grant it to clients", () => {
    expect(sql).toMatch(/create or replace function public\.apply_workflow_step_outcome\(/);
    expect(sql).toMatch(
      /revoke all on function public\.apply_workflow_step_outcome\(uuid, text, text\)\s+from public, anon, authenticated, service_role/,
    );
    expect(sql).not.toMatch(/grant execute on function public\.apply_workflow_step_outcome/);
  });

  it("keeps search_path public and actor as auth.uid on transitions", () => {
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/completed_by = auth\.uid\(\)/);
    expect(sql).toMatch(/actor_id, decision, official_code, comment[\s\S]*auth\.uid\(\)/);
  });

  it("enforces requires_approval on direct complete and applies A\/B\/C\/D atomically", () => {
    expect(sql).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql).toMatch(/p_source = 'approval_gate'/);
    expect(sql).toMatch(/when 'A' then 'complete'/);
    expect(sql).toMatch(/when 'C' then 'resubmit'/);
    expect(sql).toMatch(/when 'D' then 'reject'/);
    expect(sql).toMatch(/else null/);
    expect(sql).toMatch(/WORKFLOW_LINK_INVALID/);
  });

  it("does not mutate existing projects or start instances in the seed section", () => {
    const seed = sql.split("System project lifecycle")[1] ?? "";
    expect(seed).not.toMatch(/update public\.projects/i);
    expect(seed).not.toMatch(/workflow_instances/);
    expect(seed).toMatch(/insert into public\.workflow_definitions/);
    expect(seed).toMatch(/'project'/);
    expect(seed).toMatch(/pre_execution_approvals/);
    expect(seed).toMatch(/40000000-0000-0000-0000-000000000005/);
    expect(seed).not.toMatch(/40000000-0000-0000-0000-000000000002/);
    expect(seed).toMatch(/where not exists/);
  });

  it("does not enable WhatsApp or rewrite document_approval seed", () => {
    expect(sql).not.toMatch(/create table public\.\w*whatsapp/i);
    expect(sql).not.toMatch(/document_approval/);
    expect(sql).toMatch(/grant execute on function public\.submit_approval_decision\(uuid, text, text\) to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.complete_workflow_step\(uuid, text\) to authenticated/);
  });

  it("adds atomic legacy complete_project_stage", () => {
    expect(sql).toMatch(/create or replace function public\.complete_project_stage\(p_stage_id uuid\)/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/can_access_project\(v_stage\.project_id\)/);
    expect(sql).toMatch(/v_instance\.status in \('completed', 'cancelled'\)/);
  });
});
