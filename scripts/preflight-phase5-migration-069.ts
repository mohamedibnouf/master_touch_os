#!/usr/bin/env node
/** Read-only 069 preflight. Never logs secrets. Never writes. */
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  ORG,
  FILE_065,
  FILE_066,
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

    const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_069), "utf8");
    const integrity = {
      is_active: sql.includes("add column if not exists is_active"),
      created_by: sql.includes("add column if not exists created_by"),
      department_id: sql.includes("add column if not exists department_id"),
      role_manage: sql.includes("'role.manage'"),
      sa_gm_only: sql.includes("and r.code in ('super_admin', 'general_manager')") && !sql.includes("hr_manager"),
      viewer_role_read: /r\.code = 'viewer'/.test(sql) && sql.includes("permission_key = 'role.read'"),
      immutability: sql.includes("SYSTEM_ROLE_IMMUTABLE"),
      ddl_bypass: sql.includes("current_user <> 'postgres'") && sql.includes("allow_system_role_ddl"),
      rpcs: sql.includes("create_organization_role") && sql.includes("update_organization_role"),
      inactive_sql: sql.includes("r.is_system = true or r.is_active = true"),
      no_hard_delete_product: !/delete from public\.roles/i.test(sql),
      single_update_audit: (sql.match(/'role\.updated'/g) ?? []).length === 1 && !sql.includes("role.permissions_changed"),
    };
    console.log("migration_integrity", integrity);
    const integrityOk = Object.values(integrity).every(Boolean);
    console.log("migration_integrity_ok", integrityOk);
    if (!integrityOk) {
      console.error("STOP: local 069 is not the reviewed version.");
      process.exit(2);
    }

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations group by filename order by filename",
    );
    const n065 = mig.rows.find((r) => r.filename === FILE_065)?.n;
    const n066 = mig.rows.find((r) => r.filename === FILE_066)?.n;
    const n067 = mig.rows.find((r) => r.filename === FILE_067)?.n;
    const n068 = mig.rows.find((r) => r.filename === FILE_068)?.n;
    const n069 = mig.rows.find((r) => r.filename === FILE_069)?.n ?? 0;
    console.log("migration_counts", { n065, n066, n067, n068, n069 });
    console.log("history_pre_ok", n065 === 1 && n066 === 1 && n067 === 1 && n068 === 1 && n069 === 0);
    if (n067 !== 1 || n068 !== 1) {
      console.error("STOP: 067/068 must exist exactly once.");
      process.exit(2);
    }
    if (n069 !== 0) {
      console.error("STOP: migration 069 already recorded.");
      process.exit(2);
    }

    const counts = await client.query(`
      select
        (select count(*)::int from public.roles) as roles,
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.role_permissions) as role_permissions,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.organization_members) as organization_members,
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.job_titles) as job_titles,
        (select count(*)::int from public.departments) as departments,
        (select count(*)::int from public.roles where organization_id is null and is_system) as system_roles,
        (select count(*)::int from public.roles where organization_id is not null or not is_system) as custom_roles
    `);
    console.log("counts", counts.rows[0]);

    const employee = await grantsFor(client, "employee");
    const viewer = await grantsFor(client, "viewer");
    console.log("employee_grant_count", employee.length);
    console.log("employee_grants", employee);
    console.log(
      "employee_eight_match",
      employee.length === 8 && EIGHT.every((k) => employee.includes(k)),
    );
    console.log("viewer_grant_count", viewer.length);
    console.log("viewer_has_role_read", viewer.includes("role.read"));
    console.log("super_admin_has_role_manage", (await grantsFor(client, "super_admin")).includes("role.manage"));
    console.log("general_manager_has_role_manage", (await grantsFor(client, "general_manager")).includes("role.manage"));
    console.log("role_manage_perm_exists", (await client.query("select 1 from public.permissions where key = 'role.manage'")).rows.length);

    const admins = await client.query<{ who: string; codes: string[] }>(
      `select case
         when u.email = $1 then 'official'
         when u.email = $2 then 'primary'
       end as who,
       array_agg(r.code order by r.code) as codes
       from auth.users u
       join public.user_roles ur on ur.profile_id = u.id and ur.organization_id = $3
       join public.roles r on r.id = ur.role_id
       where u.email in ($1, $2)
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
