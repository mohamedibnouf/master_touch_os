#!/usr/bin/env node
/** Read-only 069 function ACL audit. Never writes. Never logs secrets. */
import { connect, identityOk } from "./phase5-db-gate";

const NAMES = [
  "roles_custom_org_guard",
  "current_effective_permission_keys",
  "has_permission",
  "non_delegable_permission_keys",
  "normalize_custom_role_code",
  "assert_custom_role_permission_set",
  "assert_can_manage_custom_roles",
  "replace_custom_role_permissions",
  "create_organization_role",
  "update_organization_role",
  "set_organization_role_active",
  "system_role_ddl_allowed",
  "roles_protect_system",
  "role_permissions_protect_system",
];

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }
    const rows = await client.query<{
      proname: string;
      identity: string;
      prosecdef: boolean;
      proowner: string;
      proconfig: string[] | null;
      acl: string | null;
      public_exec: boolean | null;
      anon_exec: boolean | null;
      auth_exec: boolean | null;
      service_exec: boolean | null;
    }>(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as identity,
              p.prosecdef,
              r.rolname as proowner,
              p.proconfig,
              p.proacl::text as acl,
              has_function_privilege('public', p.oid, 'execute') as public_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('service_role', p.oid, 'execute') as service_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.oid = p.proowner
       where n.nspname = 'public'
         and p.proname = any($1::text[])
       order by p.proname, 2`,
      [NAMES],
    );
    console.log("function_acl_audit", JSON.stringify(rows.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
