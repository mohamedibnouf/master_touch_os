#!/usr/bin/env node
/** Read-only 068 preflight. Never logs secrets. Never writes. */
import { connect, identityOk, ORG, FILE_065, FILE_066, FILE_067, FILE_068, EIGHT } from "./phase5-db-gate";

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

    const table = await client.query(
      `select to_regclass('public.job_titles') is not null as exists`,
    );
    console.log("job_titles_table_exists", table.rows[0]?.exists);

    const col = await client.query(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'employees' and column_name = 'job_title_id'
       ) as exists`,
    );
    console.log("employees_job_title_id_exists", col.rows[0]?.exists);

    const counts = await client.query(`
      select
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.roles) as roles,
        (select count(*)::int from public.role_permissions) as role_permissions,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.organization_members) as organization_members
    `);
    console.log("counts", counts.rows[0]);

    const titleIdCount = col.rows[0]?.exists
      ? await client.query("select count(*)::int as n from public.employees where job_title_id is not null")
      : { rows: [{ n: 0 }] };
    console.log("employees_with_job_title_id", titleIdCount.rows[0]?.n);

    const legacy = await client.query(
      `select count(*)::int as n from public.employees
       where job_title_ar is not null and btrim(job_title_ar) <> ''`,
    );
    console.log("employees_with_legacy_title_text", legacy.rows[0]?.n);

    const employeeGrants = await client.query<{ permission_key: string }>(
      `select rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null
       order by 1`,
    );
    console.log("employee_grant_count", employeeGrants.rows.length);
    console.log("employee_grants", employeeGrants.rows.map((r) => r.permission_key));
    console.log(
      "employee_eight_match",
      employeeGrants.rows.length === 8 && EIGHT.every((k) => employeeGrants.rows.some((r) => r.permission_key === k)),
    );

    const permKeys = await client.query(
      "select key from public.permissions where key in ('job_title.read','job_title.manage') order by 1",
    );
    console.log("job_title_permission_keys", permKeys.rows.map((r) => r.key));

    const n065 = mig.rows.find((r) => r.filename === FILE_065)?.n;
    const n066 = mig.rows.find((r) => r.filename === FILE_066)?.n;
    const n067 = mig.rows.find((r) => r.filename === FILE_067)?.n;
    const n068 = mig.rows.find((r) => r.filename === FILE_068)?.n ?? 0;
    console.log("history_pre_ok", n065 === 1 && n066 === 1 && n067 === 1 && n068 === 0);
    console.log("org", ORG);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
