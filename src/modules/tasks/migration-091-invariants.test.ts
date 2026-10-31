import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";
import { TASK_ENTITY_TYPES, TASK_PRIORITIES, TASK_STATUSES } from "./types";
import { DEFAULT_POINTS } from "./logic";

const sql = readFileSync("supabase/migrations/091_task_workspace.sql", "utf8");

/** Body of one `create or replace function public.<name>(` … `$$;` block. */
function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} defined in 091`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("\n$$;", open);
  return sql.slice(start, close);
}

/** SQL with function bodies and the backfill DO block removed. */
const outsideBodies = sql.replace(/as \$\$[\s\S]*?\n\$\$;/g, "").replace(/do \$\$[\s\S]*?\n\$\$;/g, "");

describe("091 task workspace — static SQL invariants", () => {
  it("is additive and idempotent", () => {
    expect(sql).toMatch(/^-- Safety:/m);
    expect(sql).not.toMatch(/drop (table|function|index|type|column)/i);
    expect(outsideBodies).not.toMatch(/^\s*(delete from|truncate)/im);
    expect(outsideBodies).not.toMatch(/^\s*update public\./im);
    const tables = [...sql.matchAll(/create table (if not exists )?public\.(\w+)/g)];
    expect(tables.length).toBe(6);
    for (const m of tables) {
      expect(m[1], `create table ${m[2]} must use if not exists`).toBe("if not exists ");
    }
    const indexes = [...sql.matchAll(/create (unique )?index [^\n]*/g)];
    expect(indexes.length).toBeGreaterThan(10);
    for (const m of indexes) expect(m[0]).toMatch(/if not exists/);
    for (const m of sql.matchAll(/create policy (\w+) on/g)) {
      expect(sql).toContain(`drop policy if exists ${m[1]} on`);
    }
    for (const m of sql.matchAll(/create trigger (\w+)/g)) {
      expect(sql).toContain(`drop trigger if exists ${m[1]} on`);
    }
    expect(sql).not.toMatch(/create function /i);
  });

  it("creates the contract tables with the contract columns", () => {
    for (const table of ["task_spaces", "task_lists", "tasks", "task_assignees", "task_comments", "task_time_entries"]) {
      expect(sql).toContain(`create table if not exists public.${table} (`);
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${table} from anon;`);
    }
    expect(sql).toMatch(/constraint task_lists_project_id_key unique \(project_id\)/);
    expect(sql).toMatch(/constraint tasks_source_key_key unique \(source_key\)/);
    expect(sql).toMatch(/primary key \(task_id, profile_id\)/);
    expect(sql).toMatch(
      /create unique index if not exists task_time_entries_running_uidx\s+on public\.task_time_entries \(profile_id\)\s+where ended_at is null;/,
    );
  });

  it("status / priority / entity / source check lists match the TypeScript enums", () => {
    expect(sql).toContain(`check (status in (${TASK_STATUSES.map((s) => `'${s}'`).join(", ")}))`);
    expect(sql).toContain(`check (priority in (${TASK_PRIORITIES.map((s) => `'${s}'`).join(", ")}))`);
    for (const type of TASK_ENTITY_TYPES) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain("check (source in ('manual', 'workflow_step', 'approval_step'))");
  });

  it("default points by priority mirror logic.ts", () => {
    const body = fnBody("tasks_before_write");
    for (const [priority, points] of Object.entries(DEFAULT_POINTS)) {
      if (priority === "normal") expect(body).toMatch(new RegExp(`else ${points}\\b`));
      else expect(body).toContain(`when '${priority}' then ${points}`);
    }
  });

  it("tasks_before_write guards auto tasks and completed_at, as SECURITY INVOKER", () => {
    const body = fnBody("tasks_before_write");
    expect(body).toMatch(/security invoker/);
    expect(body).toContain("public.workflow_write_is_untrusted()");
    expect(body).toMatch(/old\.source <> 'manual'/);
    expect(body).toContain("TASK_AUTO_LOCKED");
    for (const col of ["title", "title_en", "entity_type", "entity_id", "list_id", "due_at"]) {
      expect(body).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(body).toMatch(/if new\.status <> 'done' then\s+new\.completed_at := null;/);
    expect(body).toContain("TASK_SUBTASK_DEPTH");
  });

  it("auto-task triggers are AFTER, SECURITY DEFINER, and never fail the parent transaction", () => {
    for (const fn of [
      "task_on_project_change",
      "task_on_workflow_step_change",
      "task_on_approval_step_change",
      "task_on_approval_request_change",
    ]) {
      const body = fnBody(fn);
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path = public/);
      expect(body).toMatch(/exception when others then\s+raise warning/);
      expect(body).toMatch(/return null;/);
    }
    expect(sql).toMatch(/create trigger workflow_instance_steps_zz_task_sync\s+after insert or update/);
    expect(sql).toMatch(/create trigger approval_steps_zz_task_sync\s+after insert or update/);
    expect(sql).toMatch(/create trigger approval_requests_zz_task_sync\s+after update/);
    expect(sql).toMatch(/create trigger projects_zz_task_list\s+after insert or update/);
    // Never writes to workflow / approval tables.
    expect(sql).not.toMatch(/(update|insert into|delete from) public\.(workflow_instance_steps|workflow_instances|approval_steps|approval_requests|approval_actions)\b/);
    expect(sql).not.toMatch(/grant [^;]*on table public\.(workflow_|approval_)/);
  });

  it("workflow and approval sync use the contract source keys and mappings", () => {
    const wf = fnBody("task_sync_workflow_step");
    expect(wf).toContain("'wfs:' || v_step.id::text");
    expect(wf).toContain("'workflow_step'");
    expect(wf).toContain("'workflow_instance_step'");
    expect(wf).toMatch(/v_step\.status in \('ready', 'in_progress'\)/);
    expect(wf).toContain("project_workflow_step_assignments");
    expect(wf).toMatch(/set status = 'done'/);
    expect(wf).toMatch(/set status = 'cancelled'/);
    const ap = fnBody("task_sync_approval_step");
    expect(ap).toContain("'aps:' || v_step.id::text");
    expect(ap).toContain("'approval_step'");
    expect(ap).toContain("'approval_request'");
    expect(ap).toContain("coalesce(v_step.delegated_to, v_step.user_id)");
    expect(ap).toContain("v_request.title_en");
    expect(ap).toMatch(/o\.sequence < v_step\.sequence/);
  });

  it("backfills project lists and open steps / approvals", () => {
    const backfill = sql.slice(sql.indexOf("-- F. Backfill"), sql.indexOf("-- G. task_performance"));
    expect(backfill).toContain("perform public.task_ensure_project_list(v_id)");
    expect(backfill).toContain("perform public.task_sync_workflow_step(v_id)");
    expect(backfill).toContain("perform public.task_sync_approval_step(v_id)");
    expect(backfill.match(/exception when others then/g)?.length).toBe(3);
  });

  it("task_performance is SECURITY DEFINER and own-row-only without task.performance.read", () => {
    const body = fnBody("task_performance");
    expect(body).toMatch(/security definer/);
    expect(body).toContain("#variable_conflict use_column");
    expect(body).toContain("public.has_permission('task.performance.read', p_org)");
    expect(body).toContain("v_all or a.profile_id = v_uid");
    expect(body).toContain("v_all or e.profile_id = v_uid");
    expect(body).toContain("case when m.on_time then 1.0 else 0.5 end");
    expect(body).toContain("at time zone 'Asia/Riyadh'");
    for (const col of [
      "assigned integer",
      "completed integer",
      "completed_on_time integer",
      "overdue_open integer",
      "on_time_rate numeric",
      "avg_cycle_hours numeric",
      "logged_minutes bigint",
      "estimate_minutes_done bigint",
      "points_earned numeric",
    ]) {
      expect(body).toContain(col);
    }
    expect(sql).toMatch(/revoke all on function public\.task_performance\(uuid, date, date, uuid\) from public, anon;/);
  });

  it("internal helpers are not executable by clients", () => {
    for (const fn of [
      "task_ensure_system_space(uuid, text)",
      "task_ensure_project_list(uuid)",
      "task_ensure_approvals_list(uuid)",
      "task_sync_workflow_step(uuid)",
      "task_sync_approval_step(uuid)",
      "task_set_auto_assignee(uuid, uuid, uuid)",
      "task_project_for_entity(text, uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    }
  });

  it("seeds the four permission keys to roles consistently with the TS catalog", () => {
    const keys = ["task.read", "task.create", "task.manage", "task.performance.read"] as const;
    for (const key of keys) {
      expect(sql).toContain(`('${key}', 'task',`);
      expect(PERMISSIONS).toContain(key);
    }
    for (const role of ["general_manager", "operations_manager", "project_manager", "hr_manager", "finance_manager"] as const) {
      expect(sql).toContain(`'${role}'`);
      expect(ROLE_PERMISSION_MAP[role]).toContain("task.manage");
      expect(ROLE_PERMISSION_MAP[role]).toContain("task.performance.read");
    }
    for (const role of ["employee", "engineer", "finance_officer", "quality_officer"] as const) {
      expect(ROLE_PERMISSION_MAP[role]).toContain("task.read");
      expect(ROLE_PERMISSION_MAP[role]).toContain("task.create");
      expect(ROLE_PERMISSION_MAP[role]).not.toContain("task.manage");
    }
    expect(ROLE_PERMISSION_MAP.viewer).toContain("task.read");
    expect(ROLE_PERMISSION_MAP.viewer).not.toContain("task.create");
    expect(ROLE_PERMISSION_MAP.client).not.toContain("task.read");
  });
});
