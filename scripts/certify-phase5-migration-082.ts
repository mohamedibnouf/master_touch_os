#!/usr/bin/env node
/** Read-only certification of 082. Never updates execution items. Never completes Stage 07. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILE_082 = "082_project_execution_control.sql";
const FILE_081 = "081_project_mobilization_readiness.sql";
const STEP07 = "23ed5b0d-14ed-4b26-82d6-eed6df3cd968";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_082), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  const client = await connect();
  const report: Record<string, unknown> = { sha082: sha, org: ORG };
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations
       where filename = any($1::text[]) group by 1 order by 1`,
      [[FILE_081, FILE_082]],
    );
    report.migrations = mig.rows;

    const tables = await client.query(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('project_execution_packages', 'project_execution_items')
       order by 1`,
    );
    report.tables = tables.rows;

    const fns = await client.query(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'get_project_execution_progress',
           'set_project_execution_item',
           'project_has_execution_completion_package',
           'ensure_project_execution_package'
         )
       order by 1`,
    );
    report.functions = fns.rows;

    const stage = await client.query(
      `select s.status::text as stage07,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 8) as stage08
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP07],
    );
    report.stage = stage.rows[0];

    const pkg = await client.query(
      `select r.id, r.workflow_instance_step_id,
              (select count(*)::int from public.project_execution_items i where i.package_id = r.id) as items,
              (select count(*)::int from public.project_execution_items i where i.package_id = r.id and i.status = 'completed') as completed
       from public.project_execution_packages r
       where r.project_id = $1`,
      [PROJECT],
    );
    report.package = pkg.rows[0] ?? null;

    const helper = await client.query(
      `select public.project_has_execution_completion_package($1::uuid) as ready`,
      [PROJECT],
    );
    report.helper_ready = helper.rows[0];

    console.log(JSON.stringify(report, null, 2));
    const st = stage.rows[0] as { stage07?: string; stage08?: string };
    if (st.stage07 !== "ready" || st.stage08 !== "pending") {
      console.error("STOP: Stage 07/08 mutated");
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
