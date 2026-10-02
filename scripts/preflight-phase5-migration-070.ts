#!/usr/bin/env node
/** Read-only 070 preflight. Never writes. Never logs secrets. */
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  FILE_067,
  FILE_068,
  FILE_069,
  FILE_070,
} from "./phase5-db-gate";

const NAMES = [
  "roles_custom_org_guard",
  "roles_protect_system",
  "role_permissions_protect_system",
  "system_role_ddl_allowed",
  "current_effective_permission_keys",
  "non_delegable_permission_keys",
  "normalize_custom_role_code",
  "assert_can_manage_custom_roles",
  "assert_custom_role_permission_set",
  "replace_custom_role_permissions",
  "create_organization_role",
  "update_organization_role",
  "set_organization_role_active",
  "has_permission",
];

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", FILE_070), "utf8");
    const integrity = {
      acl_only: !/create or replace function/i.test(sql),
      no_body_replace: !/language plpgsql|language sql/i.test(sql),
      no_business_dml: !/insert into|update public\.|delete from public\./i.test(sql),
      no_069_edit: !sql.includes("add column if not exists is_active"),
      exact_replace_sig: sql.includes("public.replace_custom_role_permissions(uuid, text[])"),
      exact_create_sig: sql.includes(
        "public.create_organization_role(uuid, text, text, text, uuid, text[])",
      ),
      revoke_helpers_service: sql.includes(
        "revoke all on function public.replace_custom_role_permissions(uuid, text[])",
      ) && sql.includes("from public, anon, authenticated, service_role"),
      grant_rpc_authenticated: sql.includes(
        "grant execute on function public.create_organization_role(uuid, text, text, text, uuid, text[])",
      ),
      has_permission_auth: sql.includes(
        "grant execute on function public.has_permission(text, uuid, public.role_scope_type, uuid)",
      ),
      has_permission_not_revoked_auth:
        !/has_permission[\s\S]{0,220}from public, anon, authenticated, service_role/.test(sql),
    };
    console.log("migration_integrity", integrity);
    const integrityOk = Object.values(integrity).every(Boolean);
    console.log("migration_integrity_ok", integrityOk);
    if (!integrityOk) {
      console.error("STOP: local 070 is not the reviewed version.");
      process.exit(2);
    }

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations where filename in ($1,$2,$3,$4) group by filename order by 1",
      [FILE_067, FILE_068, FILE_069, FILE_070],
    );
    const n = Object.fromEntries(mig.rows.map((r) => [r.filename, r.n]));
    const n067 = n[FILE_067] ?? 0;
    const n068 = n[FILE_068] ?? 0;
    const n069 = n[FILE_069] ?? 0;
    const n070 = n[FILE_070] ?? 0;
    console.log("migration_counts", { n067, n068, n069, n070 });
    if (n067 !== 1 || n068 !== 1 || n069 !== 1) {
      console.error("STOP: 067/068/069 must exist exactly once.");
      process.exit(2);
    }
    if (n070 !== 0) {
      console.error("STOP: migration 070 already recorded.");
      process.exit(2);
    }

    const acls = await client.query(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as identity,
              p.prosecdef,
              r.rolname as proowner,
              has_function_privilege('public', p.oid, 'execute') as public_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('service_role', p.oid, 'execute') as service_exec,
              has_function_privilege(r.rolname, p.oid, 'execute') as owner_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.oid = p.proowner
       where n.nspname = 'public' and p.proname = any($1::text[])
       order by 1, 2`,
      [NAMES],
    );
    console.log("pre_acl", acls.rows);

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
        (select count(*)::int from public.audit_logs) as audit_logs
    `);
    console.log("counts_pre", counts.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
