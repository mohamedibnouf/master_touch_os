#!/usr/bin/env node
/** Read-only certification of 081. Never confirms checklist items. Never logs secrets. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILE_081 = "081_project_mobilization_readiness.sql";
const STEP06 = "311b6d8d-1096-4cb6-b907-dc851586e87b";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const FILE_080 = "080_workflow_procurement_completion_gate.sql";

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_081), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  const client = await connect();
  const report: Record<string, unknown> = { sha081: sha, org: ORG };
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations
       where filename = any($1::text[]) group by 1 order by 1`,
      [[FILE_080, FILE_081]],
    );
    report.migrations = mig.rows;

    const tables = await client.query(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('project_mobilization_readiness', 'project_mobilization_readiness_items')
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
           'get_project_mobilization_readiness',
           'set_project_mobilization_readiness_item',
           'project_has_mobilization_completion_package',
           'ensure_project_mobilization_readiness'
         )
       order by 1`,
    );
    report.functions = fns.rows;

    const stage = await client.query(
      `select s.status::text as stage06,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 7) as stage07
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP06],
    );
    report.stage = stage.rows[0];

    const pkg = await client.query(
      `select r.id, r.workflow_instance_step_id,
              (select count(*)::int from public.project_mobilization_readiness_items i where i.readiness_id = r.id) as items,
              (select count(*)::int from public.project_mobilization_readiness_items i where i.readiness_id = r.id and i.is_confirmed) as confirmed
       from public.project_mobilization_readiness r
       where r.project_id = $1`,
      [PROJECT],
    );
    report.package = pkg.rows[0] ?? null;

    const po = await client.query(
      `select po_number, status::text from public.purchase_orders where project_id = $1`,
      [PROJECT],
    );
    report.purchase_orders = po.rows;

    console.log(JSON.stringify(report, null, 2));
    const stage06 = (stage.rows[0] as { stage06?: string })?.stage06;
    const stage07 = (stage.rows[0] as { stage07?: string })?.stage07;
    if (stage06 !== "ready" || stage07 !== "pending") {
      console.error("STOP: workflow state changed");
      process.exit(2);
    }
    const confirmed = (pkg.rows[0] as { confirmed?: number } | undefined)?.confirmed ?? 0;
    if (confirmed > 0) {
      console.error("STOP: checklist items were confirmed");
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
