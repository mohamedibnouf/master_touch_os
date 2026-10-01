#!/usr/bin/env node
/** Read-only post-067 verification. Never logs secrets. */
import {
  connect,
  identityOk,
  ORG,
  FILE_065,
  FILE_066,
  FILE_067,
  EMPLOYEE_ROLE_ID,
  EIGHT,
  FORBIDDEN_GRANTS,
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

    const role = await client.query(
      `select id, code, name_ar, name_en, organization_id, is_system, is_external
       from public.roles where code = 'employee'`,
    );
    console.log("employee_role", role.rows);

    const grants = await client.query<{ permission_key: string }>(
      `select rp.permission_key
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null
       order by 1`,
    );
    console.log("grant_count", grants.rows.length);
    console.log("grants", grants.rows.map((r) => r.permission_key));
    console.log(
      "forbidden_present",
      FORBIDDEN_GRANTS.filter((k) => grants.rows.some((r) => r.permission_key === k)),
    );
    console.log(
      "eight_match",
      grants.rows.length === 8 && EIGHT.every((k) => grants.rows.some((r) => r.permission_key === k)),
    );

    const idOk = role.rows.length === 1 && role.rows[0]?.id === EMPLOYEE_ROLE_ID;
    console.log("role_id_match", idOk);

    const counts = await client.query(`
      select
        (select count(*)::int from public.roles) as roles,
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.role_permissions) as role_permissions,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.organization_members) as organization_members
    `);
    console.log("counts", counts.rows[0]);

    const noRole = await client.query(
      `select count(*)::int as n
       from public.employees e
       where e.organization_id = $1
         and not exists (
           select 1 from public.user_roles ur
           where ur.profile_id = e.profile_id and ur.organization_id = e.organization_id
         )`,
      [ORG],
    );
    console.log("employees_without_user_roles", noRole.rows[0]?.n);

    const rls = await client.query(`
      select count(*)::int as n from pg_policies
      where schemaname = 'public'
    `);
    console.log("public_rls_policy_count", rls.rows[0]?.n);

    const n065 = mig.rows.find((r) => r.filename === FILE_065)?.n;
    const n066 = mig.rows.find((r) => r.filename === FILE_066)?.n;
    const n067 = mig.rows.find((r) => r.filename === FILE_067)?.n;
    console.log("history_ok", n065 === 1 && n066 === 1 && n067 === 1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
