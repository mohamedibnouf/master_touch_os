#!/usr/bin/env node
/** Read-only post-068 verification. Never logs secrets. */
import {
  connect,
  identityOk,
  FILE_065,
  FILE_066,
  FILE_067,
  FILE_068,
  EIGHT,
} from "./phase5-db-gate";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations group by filename order by filename",
    );
    console.log("schema_migrations", mig.rows);

    const cols = await client.query(
      `select column_name, is_nullable, data_type
       from information_schema.columns
       where table_schema = 'public' and table_name = 'job_titles'
       order by ordinal_position`,
    );
    console.log("job_titles_columns", cols.rows);

    const empCol = await client.query(
      `select column_name, is_nullable, data_type
       from information_schema.columns
       where table_schema = 'public' and table_name = 'employees' and column_name = 'job_title_id'`,
    );
    console.log("employees_job_title_id", empCol.rows);

    const fks = await client.query(
      `select
         tc.constraint_name,
         kcu.column_name,
         ccu.table_name as foreign_table,
         rc.delete_rule
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       join information_schema.referential_constraints rc
         on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
       where tc.constraint_type = 'FOREIGN KEY'
         and (
           (tc.table_name = 'job_titles' and tc.table_schema = 'public')
           or (tc.table_name = 'employees' and kcu.column_name = 'job_title_id')
         )
       order by tc.table_name, kcu.column_name`,
    );
    console.log("foreign_keys", fks.rows);

    const idxs = await client.query(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'job_titles' order by 1`,
    );
    console.log("job_titles_indexes", idxs.rows.map((r) => r.indexname));

    const trig = await client.query(
      `select tgname, tgenabled from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'job_titles' and not tgisinternal
       order by 1`,
    );
    console.log("job_titles_triggers", trig.rows);

    const rls = await client.query(`select relrowsecurity from pg_class where relname = 'job_titles'`);
    console.log("job_titles_rls", rls.rows[0]?.relrowsecurity);

    const policies = await client.query(
      `select policyname, cmd, roles, qual is not null as has_using, with_check is not null as has_check
       from pg_policies where schemaname = 'public' and tablename = 'job_titles' order by 1`,
    );
    console.log("job_titles_policies", policies.rows);

    const perms = await client.query(
      "select key from public.permissions where key in ('job_title.read','job_title.manage') order by 1",
    );
    console.log("permission_keys", perms.rows.map((r) => r.key));

    const grants = await client.query(
      `select r.code, rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where rp.permission_key in ('job_title.read','job_title.manage')
       order by r.code, rp.permission_key`,
    );
    console.log("job_title_grants", grants.rows);

    const unexpected = grants.rows.filter(
      (g) =>
        !["super_admin", "general_manager", "hr_manager", "hr_officer"].includes(g.code) ||
        (g.code === "hr_officer" && g.permission_key === "job_title.manage"),
    );
    console.log("unexpected_grants", unexpected);

    const employee = await client.query<{ permission_key: string }>(
      `select rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null
       order by 1`,
    );
    console.log("employee_grant_count", employee.rows.length);
    console.log("employee_grants", employee.rows.map((r) => r.permission_key));
    console.log(
      "employee_eight_match",
      employee.rows.length === 8 && EIGHT.every((k) => employee.rows.some((r) => r.permission_key === k)),
    );

    const counts = await client.query(`
      select
        (select count(*)::int from public.job_titles) as job_titles,
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.employees where job_title_id is not null) as employees_with_job_title_id,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.role_permissions) as role_permissions
    `);
    console.log("counts", counts.rows[0]);

    const n065 = mig.rows.find((r) => r.filename === FILE_065)?.n;
    const n066 = mig.rows.find((r) => r.filename === FILE_066)?.n;
    const n067 = mig.rows.find((r) => r.filename === FILE_067)?.n;
    const n068 = mig.rows.find((r) => r.filename === FILE_068)?.n;
    console.log("history_ok", n065 === 1 && n066 === 1 && n067 === 1 && n068 === 1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
