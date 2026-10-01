#!/usr/bin/env node
/** Read-only 067 preflight. Never logs secrets. Never writes. */
import { connect, identityOk, ORG, FILE_065, FILE_066, FILE_067, EMPLOYEE_ROLE_ID, EIGHT } from "./phase5-db-gate";

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

    const employeeCode = await client.query("select count(*)::int as n from public.roles where code = 'employee'");
    const employeeId = await client.query("select count(*)::int as n from public.roles where id = $1", [EMPLOYEE_ROLE_ID]);
    console.log("role_code_employee_count", employeeCode.rows[0]?.n);
    console.log("role_id_018_count", employeeId.rows[0]?.n);

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

    const perms = await client.query<{ key: string }>(
      "select key from public.permissions where key = any($1::text[]) order by 1",
      [EIGHT],
    );
    console.log("eight_permissions_present", perms.rows.map((r) => r.key));
    console.log("eight_permissions_missing", EIGHT.filter((k) => !perms.rows.some((r) => r.key === k)));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
