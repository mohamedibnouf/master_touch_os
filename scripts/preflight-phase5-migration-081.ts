#!/usr/bin/env node
/** Read-only snapshot before 081. Never writes. Never logs secrets. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILES = [
  "080_workflow_procurement_completion_gate.sql",
  "081_project_mobilization_readiness.sql",
];
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const STEP06 = "311b6d8d-1096-4cb6-b907-dc851586e87b";
const ALI = "e4a8c349-120a-4494-ab4a-95b6c861639a";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    const latest = await client.query(
      `select filename from public.schema_migrations
       where filename ~ '^[0-9]{3}_'
       order by filename desc limit 3`,
    );
    const mig = await client.query(
      `select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by 1 order by 1`,
      [FILES],
    );
    const stage = await client.query(
      `select s.status::text as stage06, s.step_key, s.responsible_user_id,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 5) as stage05,
              (select x.status::text from public.workflow_instance_steps x
                where x.instance_id = s.instance_id and x.sequence = 7) as stage07
       from public.workflow_instance_steps s
       where s.id = $1`,
      [STEP06],
    );
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query(
      `select set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', $2, true)`,
      [ALI, JSON.stringify({ sub: ALI, role: "authenticated", aud: "authenticated" })],
    );
    await client.query("set local role authenticated");
    const access = await client.query(`select public.can_access_project($1::uuid) as ok`, [PROJECT]);
    const exec = await client.query(`select public.can_execute_workflow_instance_step($1::uuid) as ok`, [STEP06]);
    await client.query("ROLLBACK");
    console.log(
      JSON.stringify(
        { org: ORG, latest: latest.rows, migrations: mig.rows, stage: stage.rows[0], ali_access: access.rows[0], ali_exec: exec.rows[0] },
        null,
        2,
      ),
    );
    const row = stage.rows[0] as { stage05?: string; stage06?: string; stage07?: string; responsible_user_id?: string };
    if (row.stage05 !== "completed" || row.stage06 !== "ready" || row.stage07 !== "pending") {
      console.error("STOP: unexpected workflow state");
      process.exit(2);
    }
    if (row.responsible_user_id !== ALI) {
      console.error("STOP: Stage 06 responsible is not Ali");
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
