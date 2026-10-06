#!/usr/bin/env node
/** Read-only snapshot before 079. Never writes. Never logs secrets. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILES = [
  "073_project_workflow_approval_gate.sql",
  "074_workflow_step_deadlines.sql",
  "075_ai_intelligence_platform.sql",
  "076_project_workflow_step_responsibility.sql",
  "077_step_local_workflow_execution.sql",
  "078_operational_document_version.sql",
  "079_workflow_gate_approval_documents.sql",
];
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const INSTANCE = "8c13015c-646f-4b29-9134-55cc3a36ad94";
const STEP_04 = "578ec3ce-ec01-4a63-8785-4d82ffa27721";
const DOC = "b9b14fa2-7a04-4ff7-b559-768550873fa4";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by 1 order by 1`,
      [FILES],
    );
    const counts = await client.query(`
      select
        (select count(*)::int from public.approval_requests) as approval_requests,
        (select count(*)::int from public.approval_steps) as approval_steps,
        (select count(*)::int from public.workflow_instances) as workflow_instances,
        (select count(*)::int from public.workflow_instance_steps) as workflow_instance_steps,
        (select count(*)::int from public.documents where project_id = $1) as project_documents
    `, [PROJECT]);
    const stage = await client.query(
      `select s.id, s.status::text, s.step_key, ws.requires_approval,
              (select status::text from public.workflow_instance_steps x where x.instance_id=s.instance_id and x.sequence=5) as stage05
       from public.workflow_instance_steps s
       join public.workflow_steps ws on ws.id = s.step_id
       where s.id = $1`,
      [STEP_04],
    );
    const doc = await client.query(
      `select id, current_revision, archived_at is not null as archived
       from public.documents where id = $1 and organization_id = $2`,
      [DOC, ORG],
    );
    const openGate = await client.query(
      `select count(*)::int as n from public.approval_requests
       where entity_type='workflow_instance_step' and entity_id=$1 and status in ('pending','in_progress')`,
      [STEP_04],
    );
    console.log(
      JSON.stringify(
        {
          migrations: mig.rows,
          counts: counts.rows[0],
          instance: INSTANCE,
          stage04: stage.rows[0],
          supportingDocument: doc.rows[0],
          openGateApprovals: openGate.rows[0]?.n ?? 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
