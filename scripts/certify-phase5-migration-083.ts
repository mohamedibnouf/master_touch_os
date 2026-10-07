#!/usr/bin/env node
/** Read-only certification of 083. Never mutates packages. Never completes Stage 08/09. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILE_083 = "083_final_workflow_evidence_gates.sql";
const STEP08 = "1208e0a0-15b4-44c1-afe1-8c75f2864c00";
const STEP09 = "40ab8f7c-b03c-40a5-9c46-202aef871684";
const STEP10 = "a9203b87-15ec-4bfe-b1ac-a37490eb5390";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_083), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  const client = await connect();
  const report: Record<string, unknown> = { sha083: sha, org: ORG };
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations
       where filename = any($1::text[]) group by 1 order by 1`,
      [[FILE_083, "082_project_execution_control.sql"]],
    );
    report.migrations = mig.rows;

    const tables = await client.query(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in (
           'project_commissioning_packages',
           'project_commissioning_items',
           'project_handover_packages',
           'project_handover_items'
         )
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
           'get_project_commissioning_progress',
           'set_project_commissioning_item',
           'project_has_commissioning_completion_package',
           'ensure_project_commissioning_package',
           'get_project_handover_readiness',
           'set_project_handover_item',
           'project_has_handover_completion_package',
           'ensure_project_handover_package'
         )
       order by 1`,
    );
    report.functions = fns.rows;

    const applyDef = await client.query(
      `select pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'apply_workflow_step_outcome'`,
    );
    const def = String(applyDef.rows[0]?.def ?? "");
    report.apply_gates = {
      procurement: def.includes("WORKFLOW_PROCUREMENT_NOT_READY"),
      mobilization: def.includes("WORKFLOW_MOBILIZATION_NOT_READY"),
      execution: def.includes("WORKFLOW_EXECUTION_NOT_READY"),
      commissioning: def.includes("WORKFLOW_COMMISSIONING_NOT_READY"),
      handover: def.includes("WORKFLOW_HANDOVER_NOT_READY"),
      gate: def.includes("WORKFLOW_GATE_REQUIRED"),
    };

    const stage = await client.query(
      `select s.step_key, s.status::text
       from public.workflow_instance_steps s
       where s.id = any($1::uuid[])
       order by s.sequence`,
      [[STEP08, STEP09, STEP10]],
    );
    report.stage = stage.rows;

    const pkgs = await client.query(
      `select
         (select count(*)::int from public.project_commissioning_packages where project_id = $1) as commissioning_packages,
         (select count(*)::int from public.project_handover_packages where project_id = $1) as handover_packages`,
      [PROJECT],
    );
    report.packages = pkgs.rows[0];

    console.log(JSON.stringify(report, null, 2));
    const n083 = (mig.rows as Array<{ filename: string; n: number }>).find(
      (row) => row.filename === FILE_083,
    )?.n;
    if (n083 !== 1) {
      console.error("STOP: 083 not recorded once");
      process.exit(2);
    }
    const gates = report.apply_gates as Record<string, boolean>;
    if (Object.values(gates).some((ok) => ok !== true)) {
      console.error("STOP: apply missing a required gate");
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
