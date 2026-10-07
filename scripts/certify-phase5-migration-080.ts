#!/usr/bin/env node
/** Read-only certification of 080. Never creates procurement rows. Never logs secrets. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILE_080 = "080_workflow_procurement_completion_gate.sql";
const STEP05 = "f12521e3-1a80-4a94-b653-f1161646ae61";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const ALI = "e4a8c349-120a-4494-ab4a-95b6c861639a";
const PRIOR = [
  "073_project_workflow_approval_gate.sql",
  "074_workflow_step_deadlines.sql",
  "075_ai_intelligence_platform.sql",
  "076_project_workflow_step_responsibility.sql",
  "077_step_local_workflow_execution.sql",
  "078_operational_document_version.sql",
  "079_workflow_gate_approval_documents.sql",
];

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_080), "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  const client = await connect();
  const report: Record<string, unknown> = { sha080: sha, org: ORG };
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations
       where filename = any($1::text[]) group by 1 order by 1`,
      [[...PRIOR, FILE_080]],
    );
    report.migrations = mig.rows;

    const fn = await client.query(
      `select p.prosecdef as security_definer,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='get_project_procurement_readiness'`,
    );
    report.readiness_fn = fn.rows;

    const pkg = await client.query(
      `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='project_has_procurement_completion_package'`,
    );
    report.package_fn_authenticated_execute = pkg.rows[0];

    const stage = await client.query(
      `select s.status::text as stage05, s.step_key,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 6) as stage06
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP05],
    );
    report.stage = stage.rows[0];

    const pkgBool = await client.query(
      `select public.project_has_procurement_completion_package($1::uuid) as ok`,
      [PROJECT],
    );
    report.package_ready_as_admin = pkgBool.rows[0];

    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query(
      `select set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', $2, true)`,
      [ALI, JSON.stringify({ sub: ALI, role: "authenticated", aud: "authenticated" })],
    );
    await client.query("set local role authenticated");
    const ready = await client.query(`select public.get_project_procurement_readiness($1::uuid) as payload`, [PROJECT]);
    await client.query("ROLLBACK");
    report.ali_readiness = ready.rows[0];

    console.log(JSON.stringify(report, null, 2));
    const stage05 = (stage.rows[0] as { stage05?: string })?.stage05;
    const stage06 = (stage.rows[0] as { stage06?: string })?.stage06;
    if (stage05 !== "ready" || stage06 !== "pending") {
      console.error("STOP: workflow state changed");
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
