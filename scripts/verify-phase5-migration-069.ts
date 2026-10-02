#!/usr/bin/env node
/** Read-only post-069 verification. Never logs secrets. */
import {
  connect,
  identityOk,
  ORG,
  FILE_067,
  FILE_068,
  FILE_069,
  EIGHT,
} from "./phase5-db-gate";

const OFFICIAL = "info@mastertouch-ksa.com";
const PRIMARY = "mohamedibnouf.en@gmail.com";

async function grantsFor(client: import("pg").Client, code: string): Promise<string[]> {
  const r = await client.query<{ permission_key: string }>(
    `select rp.permission_key
     from public.role_permissions rp
     join public.roles r on r.id = rp.role_id
     where r.code = $1 and r.organization_id is null
     order by 1`,
    [code],
  );
  return r.rows.map((row) => row.permission_key);
}

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations where filename in ($1,$2,$3) group by filename order by 1",
      [FILE_067, FILE_068, FILE_069],
    );
    console.log("migration_registration", mig.rows);

    const cols = await client.query(
      `select column_name, is_nullable, column_default
       from information_schema.columns
       where table_schema='public' and table_name='roles'
         and column_name in ('is_active','created_by','department_id')
       order by 1`,
    );
    console.log("roles_new_columns", cols.rows);

    const fks = await client.query(
      `select tc.constraint_name, kcu.column_name, ccu.table_name as foreign_table, rc.delete_rule
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       join information_schema.referential_constraints rc
         on rc.constraint_name = tc.constraint_name
       where tc.table_schema='public' and tc.table_name='roles' and tc.constraint_type='FOREIGN KEY'
       order by 1`,
    );
    console.log("roles_fks", fks.rows);

    const roleStats = await client.query(`
      select
        count(*)::int as roles,
        count(*) filter (where organization_id is null and is_system)::int as system_roles,
        count(*) filter (where organization_id is not null or not is_system)::int as custom_roles,
        count(*) filter (where is_active)::int as active_roles
      from public.roles
    `);
    console.log("role_stats", roleStats.rows[0]);

    const counts = await client.query(`
      select
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.role_permissions) as role_permissions,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.organization_members) as organization_members,
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.job_titles) as job_titles,
        (select count(*)::int from public.departments) as departments
    `);
    console.log("counts", counts.rows[0]);

    const manage = await client.query<{ code: string }>(
      `select r.code from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where rp.permission_key = 'role.manage' order by 1`,
    );
    console.log("role_manage_grants", manage.rows.map((r) => r.code));
    console.log(
      "role_manage_perm_count",
      (await client.query("select count(*)::int as n from public.permissions where key = 'role.manage'")).rows[0]?.n,
    );

    const employee = await grantsFor(client, "employee");
    const viewer = await grantsFor(client, "viewer");
    console.log("employee_grants", employee);
    console.log("employee_eight_match", employee.length === 8 && EIGHT.every((k) => employee.includes(k)));
    console.log("viewer_grants", viewer);
    console.log("viewer_has_role_read", viewer.includes("role.read"));

    const jobTitlePerms = await client.query<{ key: string }>(
      `select key from public.permissions where key in ('job_title.read','job_title.manage') order by 1`,
    );
    console.log("job_title_permissions", jobTitlePerms.rows.map((r) => r.key));

    const sa = await grantsFor(client, "super_admin");
    const gm = await grantsFor(client, "general_manager");
    console.log("super_admin_has_role_manage", sa.includes("role.manage"));
    console.log("general_manager_has_role_manage", gm.includes("role.manage"));
    console.log("employee_has_role_manage", employee.includes("role.manage"));
    console.log("viewer_has_role_manage", viewer.includes("role.manage"));

    const policies = await client.query(
      `select tablename, policyname, cmd from pg_policies
       where schemaname='public' and tablename in ('roles','role_permissions') order by 1,2`,
    );
    console.log("rbac_policies", policies.rows);

    const hp = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.has_permission(text, uuid, public.role_scope_type, uuid)'::regprocedure) as def`,
    );
    console.log("has_permission_inactive_guard", String(hp.rows[0]?.def ?? "").includes("r.is_system = true or r.is_active = true"));

    const admins = await client.query<{ who: string; codes: string[] }>(
      `select case when u.email = $1 then 'official' when u.email = $2 then 'primary' end as who,
              array_agg(r.code order by r.code) as codes
       from auth.users u
       join public.user_roles ur on ur.profile_id = u.id and ur.organization_id = $3
       join public.roles r on r.id = ur.role_id
       where u.email in ($1,$2)
       group by 1`,
      [OFFICIAL, PRIMARY, ORG],
    );
    console.log("admin_role_codes", admins.rows);
    console.log("org", ORG);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
