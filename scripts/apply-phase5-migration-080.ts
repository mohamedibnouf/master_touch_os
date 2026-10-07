#!/usr/bin/env node
/** Apply 080 once. Identity-gated. Does not rerun 073–079 or create procurement rows. */
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
];
const FILE_080 = "080_workflow_procurement_completion_gate.sql";

async function countFile(client: import("pg").Client, filename: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from public.schema_migrations where filename = $1",
    [filename],
  );
  return r.rows[0]?.n ?? 0;
}

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_080), "utf8");
  if (
    /create or replace function public\.submit_approval_decision/i.test(sql) ||
    /create or replace function public\.can_execute_workflow_instance_step/i.test(sql) ||
    /NOTIFICATION_WHATSAPP/i.test(sql) ||
    /openai/i.test(sql) ||
    /insert\s+into\s+public\.purchase_orders\b/i.test(sql) ||
    /insert\s+into\s+public\.purchase_requests\b/i.test(sql) ||
    /grant execute[^\n]+to public/i.test(sql) ||
    /grant execute[^\n]+to anon/i.test(sql)
  ) {
    console.error("STOP: 080 failed local integrity review.");
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
    if ((await countFile(client, FILE_080)) !== 0) {
      console.error("STOP: 080 already recorded.");
      process.exit(2);
    }

    console.log(`apply ${FILE_080}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_080]);
      await client.query("commit");
      console.log(`ok ${FILE_080}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_080}`, err instanceof Error ? err.message : "error");
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
