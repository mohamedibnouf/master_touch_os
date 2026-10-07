#!/usr/bin/env node
/** Read-only snapshot before 080. Never writes. Never logs secrets. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILES = [
  "073_project_workflow_approval_gate.sql",
  "074_workflow_step_deadlines.sql",
  "075_ai_intelligence_platform.sql",
  "076_project_workflow_step_responsibility.sql",
  "077_step_local_workflow_execution.sql",
  "078_operational_document_version.sql",
  "079_workflow_gate_approval_documents.sql",
  "080_workflow_procurement_completion_gate.sql",
];
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const INSTANCE = "8c13015c-646f-4b29-9134-55cc3a36ad94";
const STEP05 = "f12521e3-1a80-4a94-b653-f1161646ae61";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by 1 order by 1`,
      [FILES],
    );
    const stage = await client.query(
      `select s.status::text as stage05, s.step_key,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 6) as stage06
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP05],
    );
    const counts = await client.query(
      `select
         (select count(*)::int from public.purchase_requests where project_id = $1) as pr,
         (select count(*)::int from public.rfqs where project_id = $1) as rfq,
         (select count(*)::int from public.purchase_orders where project_id = $1) as po
      `,
      [PROJECT],
    );
    console.log(
      JSON.stringify(
        { org: ORG, instance: INSTANCE, migrations: mig.rows, stage: stage.rows[0], project_counts: counts.rows[0] },
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
