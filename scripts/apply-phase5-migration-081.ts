#!/usr/bin/env node
/** Apply 081 once. Identity-gated. Does not rerun 073–080 or confirm checklist items. */
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk } from "./phase5-db-gate";

const PRIOR = [
  "073_project_workflow_approval_gate.sql",
  "074_workflow_step_deadlines.sql",
  "075_ai_intelligence_platform.sql",
  "076_project_workflow_step_responsibility.sql",
  "077_step_local_workflow_execution.sql",
  "078_operational_document_version.sql",
  "079_workflow_gate_approval_documents.sql",
  "080_workflow_procurement_completion_gate.sql",
];
const FILE_081 = "081_project_mobilization_readiness.sql";

async function countFile(client: import("pg").Client, filename: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from public.schema_migrations where filename = $1",
    [filename],
  );
  return r.rows[0]?.n ?? 0;
}

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_081), "utf8");
  if (
    /drop table/i.test(sql) ||
    /truncate /i.test(sql) ||
    /create or replace function public\.can_execute_workflow_instance_step/i.test(sql) ||
    /create or replace function public\.submit_approval_decision/i.test(sql) ||
    /NOTIFICATION_WHATSAPP/i.test(sql) ||
    /openai/i.test(sql) ||
    /insert\s+into\s+public\.purchase_orders\b/i.test(sql) ||
    /update\s+public\.workflow_instance_steps[\s\S]{0,80}status\s*=\s*'completed'/i.test(sql) &&
      !sql.includes("create or replace function public.apply_workflow_step_outcome") ||
    /grant execute[^\n]+to public/i.test(sql) ||
    /grant execute[^\n]+to anon/i.test(sql)
  ) {
    console.error("STOP: 081 failed local integrity review.");
    process.exit(2);
  }

  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    for (const f of PRIOR) {
      const n = await countFile(client, f);
      if (n !== 1) {
        console.error(`STOP: ${f} count`, n);
        process.exit(2);
      }
    }
    if ((await countFile(client, FILE_081)) !== 0) {
      console.error("STOP: 081 already recorded.");
      process.exit(2);
    }

    console.log(`apply ${FILE_081}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_081]);
      await client.query("commit");
      console.log(`ok ${FILE_081}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_081}`, err instanceof Error ? err.message : "error");
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
