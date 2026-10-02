#!/usr/bin/env node
/** Read-only 068 snapshot extras. Never logs secrets or personal names. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const fks = await client.query(
      `select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as def
       from pg_constraint
       where contype = 'f'
         and (
           conrelid = 'public.job_titles'::regclass
           or (conrelid = 'public.employees'::regclass and conname ilike '%job_title%')
         )
       order by 1, 2`,
    );
    console.log("fk_defs", fks.rows);

    const idxs = await client.query(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'job_titles' order by 1`,
    );
    console.log("index_defs", idxs.rows);

    const trig = await client.query(
      `select t.tgname, t.tgenabled, p.proname
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'job_titles' and not t.tgisinternal
       order by 1`,
    );
    console.log("triggers", trig.rows);

    const fn = await client.query(
      `select pg_get_functiondef('public.job_titles_same_org()'::regprocedure) as def`,
    );
    const def = String(fn.rows[0]?.def ?? "");
    console.log("function_has_department_mismatch", def.includes("JOB_TITLE_DEPARTMENT_ORG_MISMATCH"));
    console.log("function_has_created_by_mismatch", def.includes("JOB_TITLE_CREATED_BY_ORG_MISMATCH"));
    console.log("function_has_duplicate_message_option", /message\s*=/i.test(def));

    const pol = await client.query(
      `select policyname, cmd, roles, qual, with_check
       from pg_policies where schemaname = 'public' and tablename = 'job_titles' order by 1`,
    );
    console.log("policies", pol.rows);

    const hashes = await client.query(
      `select
         count(*)::int as employees,
         count(*) filter (where job_title_id is not null)::int as with_fk,
         count(*) filter (where job_title_id is null)::int as without_fk,
         md5(string_agg(id::text || '|' || coalesce(job_title_ar,'') || '|' || coalesce(job_title_en,''), ',' order by id)) as legacy_title_hash
       from public.employees
       where organization_id = $1`,
      [ORG],
    );
    console.log("employee_title_aggregates", hashes.rows[0]);

    const custom = await client.query(
      `select
         (select count(*)::int from public.permissions where key = 'role.manage') as role_manage_perm,
         (select to_regclass('public.schema_migrations') is not null) as schema_migrations_exists,
         (select count(*)::int from public.schema_migrations where filename like '069%') as mig_069,
         (select exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='roles' and column_name='department_id'
          )) as roles_department_id`,
    );
    console.log("custom_role_freeze", custom.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
