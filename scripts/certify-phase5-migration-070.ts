#!/usr/bin/env node
/**
 * 070 certification: ACL matrix, SET ROLE execution, rollback-safe regressions.
 * Does not persist custom roles or change admin accounts.
 */
import { connect, identityOk, ORG, EIGHT, FILE_067, FILE_068, FILE_069, FILE_070 } from "./phase5-db-gate";

type Case = { id: string; status: "PASS" | "FAIL" | "NOT LIVE-CERTIFIED"; detail?: string };

const OFFICIAL = "info@mastertouch-ksa.com";
const PRIMARY = "mohamedibnouf.en@gmail.com";

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

const HELPERS = [
  "assert_can_manage_custom_roles",
  "assert_custom_role_permission_set",
  "replace_custom_role_permissions",
  "current_effective_permission_keys",
  "non_delegable_permission_keys",
  "normalize_custom_role_code",
];
const TRIGGERS = ["roles_custom_org_guard", "roles_protect_system", "role_permissions_protect_system"];
const RPCS = ["create_organization_role", "update_organization_role", "set_organization_role_active"];

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string };
    return [o.message, o.code].filter(Boolean).join(" | ");
  }
  return String(e);
}

function denied(msg: string): boolean {
  return /permission denied/i.test(msg);
}

async function main() {
  const client = await connect();
  const cases: Case[] = [];
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations where filename in ($1,$2,$3,$4) group by filename order by 1",
      [FILE_067, FILE_068, FILE_069, FILE_070],
    );
    console.log("migration_registration", mig.rows);
    const n070 = mig.rows.find((r) => r.filename === FILE_070)?.n ?? 0;
    const n069 = mig.rows.find((r) => r.filename === FILE_069)?.n ?? 0;
    cases.push({ id: "history_069_once", status: n069 === 1 ? "PASS" : "FAIL", detail: String(n069) });
    cases.push({ id: "history_070_once", status: n070 === 1 ? "PASS" : "FAIL", detail: String(n070) });

    const acls = await client.query<{
      proname: string;
      identity: string;
      prosecdef: boolean;
      proowner: string;
      public_exec: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
      owner_exec: boolean;
    }>(
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
    console.log("post_acl", acls.rows);
    const byName = Object.fromEntries(acls.rows.map((r) => [r.proname, r]));

    const closed = (name: string, serviceNo: boolean) => {
      const row = byName[name];
      if (!row) return false;
      return (
        row.proowner === "postgres" &&
        row.owner_exec === true &&
        row.public_exec === false &&
        row.anon_exec === false &&
        row.auth_exec === false &&
        (serviceNo ? row.service_exec === false : true)
      );
    };

    cases.push({
      id: "acl_helpers",
      status: HELPERS.every((n) => closed(n, true)) ? "PASS" : "FAIL",
    });
    cases.push({
      id: "acl_triggers",
      status: TRIGGERS.every((n) => closed(n, true)) ? "PASS" : "FAIL",
    });
    cases.push({
      id: "acl_ddl_helper",
      status: closed("system_role_ddl_allowed", true) ? "PASS" : "FAIL",
    });
    const rpcOk = RPCS.every((n) => {
      const row = byName[n];
      return (
        row &&
        row.proowner === "postgres" &&
        row.public_exec === false &&
        row.anon_exec === false &&
        row.auth_exec === true &&
        row.service_exec === false
      );
    });
    cases.push({ id: "acl_public_rpcs", status: rpcOk ? "PASS" : "FAIL" });
    const hp = byName.has_permission;
    cases.push({
      id: "acl_has_permission",
      status:
        hp &&
        hp.public_exec === false &&
        hp.anon_exec === false &&
        hp.auth_exec === true &&
        hp.service_exec === true
          ? "PASS"
          : "FAIL",
      detail: hp
        ? `public=${hp.public_exec},anon=${hp.anon_exec},auth=${hp.auth_exec},service=${hp.service_exec}`
        : "missing",
    });
    cases.push({
      id: "ownership_postgres",
      status: acls.rows.every((r) => r.proowner === "postgres") ? "PASS" : "FAIL",
    });

    const employee = await client.query<{ permission_key: string }>(
      `select rp.permission_key from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null`,
    );
    cases.push({
      id: "employee_eight",
      status:
        employee.rows.length === 8 && EIGHT.every((k) => employee.rows.some((r) => r.permission_key === k))
          ? "PASS"
          : "FAIL",
    });

    const viewerRead = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'viewer' and r.organization_id is null and rp.permission_key = 'role.read'`,
    );
    cases.push({ id: "viewer_no_role_read", status: viewerRead.rows[0]?.n === 0 ? "PASS" : "FAIL" });

    const manage = await client.query<{ code: string }>(
      `select r.code from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where rp.permission_key = 'role.manage' order by 1`,
    );
    const manageCodes = manage.rows.map((r) => r.code);
    cases.push({
      id: "role_manage_sa_gm_only",
      status:
        manageCodes.length === 2 && manageCodes.includes("super_admin") && manageCodes.includes("general_manager")
          ? "PASS"
          : "FAIL",
      detail: manageCodes.join(","),
    });

    const custom = await client.query<{ n: number }>(
      `select count(*)::int as n from public.roles where organization_id is not null or not is_system`,
    );
    cases.push({ id: "custom_roles_zero", status: custom.rows[0]?.n === 0 ? "PASS" : "FAIL" });

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
    const codesFor = (who: string) => admins.rows.find((r) => r.who === who)?.codes ?? [];
    const adminOk = (codes: string[]) =>
      codes.length === 2 && codes.includes("super_admin") && codes.includes("general_manager");
    cases.push({ id: "primary_admin", status: adminOk(codesFor("primary")) ? "PASS" : "FAIL" });
    cases.push({ id: "official_admin", status: adminOk(codesFor("official")) ? "PASS" : "FAIL" });

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
    console.log("counts_post", counts.rows[0]);

    await client.query("begin");
    const run = async (id: string, fn: () => Promise<void>) => {
      const sp = id.replace(/[^a-zA-Z0-9]/g, "_");
      await client.query(`savepoint ${sp}`);
      try {
        await fn();
        await client.query(`release savepoint ${sp}`);
      } catch (e) {
        await client.query(`rollback to savepoint ${sp}`);
        throw e;
      }
    };

    const tryRoleCall = async (
      role: "anon" | "authenticated",
      sql: string,
      params: unknown[] = [],
    ): Promise<{ ok: boolean; msg: string }> => {
      const sp = `sp_${role}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query(`savepoint ${sp}`);
      try {
        await client.query(`set local role ${role}`);
        await client.query(sql, params);
        await client.query(`rollback to savepoint ${sp}`);
        return { ok: true, msg: "succeeded" };
      } catch (e) {
        await client.query(`rollback to savepoint ${sp}`);
        return { ok: false, msg: errMsg(e) };
      }
    };

    const createSql =
      "select public.create_organization_role($1::uuid,'x','x','x',null,array['notification.read']::text[])";
    const anonCreate = await tryRoleCall("anon", createSql, [ORG]);
    const anonHelper = await tryRoleCall(
      "anon",
      "select public.replace_custom_role_permissions($1::uuid, array['notification.read']::text[])",
      ["00000000-0000-0000-0000-000000000001"],
    );
    const anonAssert = await tryRoleCall("anon", "select public.assert_can_manage_custom_roles($1::uuid)", [ORG]);
    console.log("anon_create", anonCreate);
    console.log("anon_helper", anonHelper);
    console.log("anon_assert", anonAssert);
    if (/cannot set|does not exist|permission denied to set role/i.test(anonCreate.msg) && !anonCreate.ok) {
      cases.push({
        id: "anon_rpc_live",
        status: "NOT LIVE-CERTIFIED",
        detail: anonCreate.msg.slice(0, 180),
      });
      cases.push({
        id: "anon_helper_live",
        status: "NOT LIVE-CERTIFIED",
        detail: anonHelper.msg.slice(0, 180),
      });
    } else {
      cases.push({
        id: "anon_rpc_live",
        status: !anonCreate.ok && denied(anonCreate.msg) ? "PASS" : "FAIL",
        detail: anonCreate.msg.slice(0, 180),
      });
      cases.push({
        id: "anon_helper_live",
        status: !anonHelper.ok && denied(anonHelper.msg) && !anonAssert.ok && denied(anonAssert.msg) ? "PASS" : "FAIL",
        detail: `${anonHelper.msg.slice(0, 80)} | ${anonAssert.msg.slice(0, 80)}`,
      });
    }

    const authHelper = await tryRoleCall(
      "authenticated",
      "select public.replace_custom_role_permissions($1::uuid, array['notification.read']::text[])",
      ["00000000-0000-0000-0000-000000000001"],
    );
    const authAssert = await tryRoleCall(
      "authenticated",
      "select public.assert_can_manage_custom_roles($1::uuid)",
      [ORG],
    );
    console.log("auth_helper", authHelper);
    console.log("auth_assert", authAssert);
    cases.push({
      id: "authenticated_helper_denied",
      status: !authHelper.ok && denied(authHelper.msg) && !authAssert.ok && denied(authAssert.msg) ? "PASS" : "FAIL",
      detail: `${authHelper.msg.slice(0, 80)} | ${authAssert.msg.slice(0, 80)}`,
    });

    const authRpc = await tryRoleCall("authenticated", createSql, [ORG]);
    console.log("auth_rpc", authRpc);
    if (authRpc.ok) {
      cases.push({ id: "authenticated_rpc_execute", status: "FAIL", detail: "create succeeded" });
    } else if (denied(authRpc.msg) && /function create_organization_role/i.test(authRpc.msg)) {
      cases.push({ id: "authenticated_rpc_execute", status: "FAIL", detail: authRpc.msg.slice(0, 180) });
    } else if (/FORBIDDEN|ROLE_|P0001/i.test(authRpc.msg)) {
      cases.push({
        id: "authenticated_rpc_execute",
        status: "PASS",
        detail: authRpc.msg.slice(0, 180),
      });
    } else {
      cases.push({ id: "authenticated_rpc_execute", status: "FAIL", detail: authRpc.msg.slice(0, 180) });
    }

    let parent: { ok: boolean; msg: string };
    try {
      await run("parent_rpc", async () => {
        await client.query(createSql, [ORG]);
      });
      parent = { ok: true, msg: "succeeded" };
    } catch (e) {
      parent = { ok: false, msg: errMsg(e) };
    }
    console.log("parent_rpc", parent);
    if (parent.ok) {
      cases.push({ id: "parent_invokes_helpers", status: "FAIL", detail: "create succeeded as postgres" });
    } else if (denied(parent.msg) && /assert_can_manage|replace_custom_role|assert_custom_role/i.test(parent.msg)) {
      cases.push({ id: "parent_invokes_helpers", status: "FAIL", detail: parent.msg.slice(0, 180) });
    } else if (/FORBIDDEN/i.test(parent.msg)) {
      cases.push({ id: "parent_invokes_helpers", status: "PASS", detail: parent.msg.slice(0, 180) });
    } else {
      cases.push({ id: "parent_invokes_helpers", status: "FAIL", detail: parent.msg.slice(0, 180) });
    }

    const hpAuth = await tryRoleCall(
      "authenticated",
      "select public.has_permission('notification.read', $1::uuid, 'organization', null)",
      [ORG],
    );
    console.log("has_permission_auth", hpAuth);
    cases.push({
      id: "has_permission_authenticated_exec",
      status: hpAuth.ok ? "PASS" : "FAIL",
      detail: hpAuth.msg.slice(0, 180),
    });

    const rlsAuth = await tryRoleCall("authenticated", "select count(*)::int as n from public.roles");
    console.log("rls_roles_select", rlsAuth);
    cases.push({
      id: "rls_roles_select_authenticated",
      status: rlsAuth.ok ? "PASS" : "FAIL",
      detail: rlsAuth.msg.slice(0, 180),
    });

    try {
      await run("sys_mut", async () => {
        await client.query(
          `update public.roles set name_en = name_en || 'x' where code = 'employee' and organization_id is null`,
        );
      });
      cases.push({ id: "system_role_immutable", status: "FAIL", detail: "update succeeded" });
    } catch (e) {
      cases.push({
        id: "system_role_immutable",
        status: String(errMsg(e)).includes("SYSTEM_ROLE_IMMUTABLE") ? "PASS" : "FAIL",
        detail: errMsg(e).slice(0, 160),
      });
    }

    try {
      await run("guc", async () => {
        await client.query("select set_config('master_touch.allow_system_role_ddl', 'on', true)");
        await client.query(
          `update public.roles set name_en = name_en where code = 'employee' and organization_id is null`,
        );
      });
      cases.push({ id: "ddl_bypass_postgres_guc", status: "PASS" });
    } catch (e) {
      cases.push({ id: "ddl_bypass_postgres_guc", status: "FAIL", detail: errMsg(e).slice(0, 160) });
    }

    const ddlAuth = await tryRoleCall("authenticated", `select public.system_role_ddl_allowed()`);
    cases.push({
      id: "ddl_helper_authenticated_denied",
      status: !ddlAuth.ok && denied(ddlAuth.msg) ? "PASS" : "FAIL",
      detail: ddlAuth.msg.slice(0, 160),
    });

    await client.query("rollback");

    const customAfter = await client.query<{ n: number }>(
      `select count(*)::int as n from public.roles where organization_id is not null or not is_system`,
    );
    cases.push({
      id: "no_persistent_custom_role",
      status: customAfter.rows[0]?.n === 0 ? "PASS" : "FAIL",
    });

    const failed = cases.filter((c) => c.status === "FAIL");
    console.log("cert_cases", cases);
    if (failed.length) {
      console.error("CERT_FAIL", failed.map((c) => c.id).join(","));
      process.exit(1);
    }
    console.log("cert_ok", true);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
