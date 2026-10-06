#!/usr/bin/env node
/** Read-only certification of 079. Never creates approvals. Never logs secrets. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILE_079 = "079_workflow_gate_approval_documents.sql";
const STEP_04 = "578ec3ce-ec01-4a63-8785-4d82ffa27721";
const DOC = "b9b14fa2-7a04-4ff7-b559-768550873fa4";
const PRIOR = [
  "073_project_workflow_approval_gate.sql",
  "074_workflow_step_deadlines.sql",
  "075_ai_intelligence_platform.sql",
  "076_project_workflow_step_responsibility.sql",
  "077_step_local_workflow_execution.sql",
  "078_operational_document_version.sql",
];

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_079), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  const client = await connect();
  const report: Record<string, unknown> = { sha079: sha };
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations
       where filename = any($1::text[]) group by 1 order by 1`,
      [[...PRIOR, FILE_079]],
    );
    report.migrations = mig.rows;

    const fn = await client.query(
      `select p.prosecdef as security_definer, p.proconfig as config,
              pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='create_current_workflow_gate_approval'`,
    );
    report.create_fn = fn.rows;

    const acl = await client.query(
      `select r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.rolname in ('public','anon','authenticated','service_role')
       where n.nspname='public' and p.proname='create_current_workflow_gate_approval'`,
    );
    report.acl = acl.rows;

    const idx = await client.query(
      `select indexname from pg_indexes
       where tablename='approval_requests' and indexname='approval_requests_open_workflow_step_uidx'`,
    );
    report.open_gate_index = idx.rows.length === 1;

    const table = await client.query(
      `select count(*)::int as n from information_schema.tables
       where table_schema='public' and table_name='approval_request_documents'`,
    );
    report.junction_table = table.rows[0]?.n === 1;

    const junctionRows = await client.query<{ n: number }>(
      `select count(*)::int as n from public.approval_request_documents`,
    );
    report.junction_row_count = junctionRows.rows[0]?.n ?? 0;

    const stage = await client.query(
      `select s.status::text as stage04, s.step_key,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 5) as stage05
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP_04],
    );
    report.stage = stage.rows[0];

    const open = await client.query<{ n: number }>(
      `select count(*)::int as n from public.approval_requests
       where entity_type='workflow_instance_step' and entity_id=$1 and status in ('pending','in_progress')`,
      [STEP_04],
    );
    report.open_gate_on_stage04 = open.rows[0]?.n ?? 0;

    const doc = await client.query(
      `select current_revision, archived_at from public.documents where id=$1 and organization_id=$2`,
      [DOC, ORG],
    );
    report.supporting_document = doc.rows[0];

    const submitStill073 = await client.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='submit_approval_decision'`,
    );
    const src = submitStill073.rows[0]?.src ?? "";
    report.submit_uses_entity_type = src.includes("workflow_instance_step");
    report.submit_A_complete = src.includes("'A' then 'complete'");
    report.submit_E_null = src.includes("else null");

    const ok =
      (mig.rows as Array<{ filename: string; n: number }>).every((r) => r.n === 1) &&
      (mig.rows as Array<{ filename: string }>).length === 7 &&
      report.open_gate_index === true &&
      report.junction_table === true &&
      report.junction_row_count === 0 &&
      report.open_gate_on_stage04 === 0 &&
      (report.stage as { stage04?: string; stage05?: string })?.stage04 === "ready" &&
      (report.stage as { stage04?: string; stage05?: string })?.stage05 === "pending" &&
      (report.supporting_document as { current_revision?: string })?.current_revision === "A";

    report.certified = ok;
    console.log(JSON.stringify(report, null, 2));
    if (!ok) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
