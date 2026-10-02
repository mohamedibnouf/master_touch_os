#!/usr/bin/env node
/**
 * 069 certification: rolled-back mutation tests + function inspection.
 * Does not persist custom roles or change admin accounts.
 */
import { connect, identityOk, ORG, EIGHT } from "./phase5-db-gate";

type Case = { id: string; status: "PASS" | "FAIL" | "NOT LIVE-CERTIFIED"; detail?: string };

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; code?: string };
    return [o.message, o.code].filter(Boolean).join(" | ");
  }
  return String(e);
}

async function main() {
  const client = await connect();
  const cases: Case[] = [];
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }

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

    const viewer = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'viewer' and r.organization_id is null and rp.permission_key = 'role.read'`,
    );
    cases.push({ id: "viewer_no_role_read", status: viewer.rows[0]?.n === 0 ? "PASS" : "FAIL" });

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

    const denied = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where rp.permission_key = 'role.manage'
         and r.code in ('employee','viewer','hr_manager','hr_officer')`,
    );
    cases.push({ id: "role_manage_not_hr_employee_viewer", status: denied.rows[0]?.n === 0 ? "PASS" : "FAIL" });

    const pol = await client.query<{ cmd: string }>(
      `select cmd from pg_policies where schemaname='public' and tablename in ('roles','role_permissions')`,
    );
    cases.push({
      id: "roles_select_only",
      status: pol.rows.every((p) => p.cmd === "SELECT") ? "PASS" : "FAIL",
      detail: pol.rows.map((p) => p.cmd).join(","),
    });

    const denylist = await client.query<{ keys: string[] }>(
      `select public.non_delegable_permission_keys() as keys`,
    );
    const expected = [
      "settings.manage",
      "role.manage",
      "role.assign",
      "user.create",
      "user.disable",
      "user.update",
      "organization.update",
    ];
    const got = denylist.rows[0]?.keys ?? [];
    cases.push({
      id: "denylist_keys",
      status: expected.every((k) => got.includes(k)) && got.length === expected.length ? "PASS" : "FAIL",
      detail: got.join(","),
    });

    const hp = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.has_permission(text, uuid, public.role_scope_type, uuid)'::regprocedure) as def`,
    );
    cases.push({
      id: "has_permission_inactive",
      status: String(hp.rows[0]?.def ?? "").includes("r.is_system = true or r.is_active = true") ? "PASS" : "FAIL",
    });

    const createDef = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.create_organization_role(uuid, text, text, text, uuid, text[])'::regprocedure) as def`,
    );
    const cdef = String(createDef.rows[0]?.def ?? "");
    cases.push({
      id: "rpc_create_security",
      status:
        cdef.includes("SECURITY DEFINER") &&
        cdef.includes("search_path") &&
        cdef.includes("assert_can_manage_custom_roles") &&
        cdef.includes("assert_custom_role_permission_set") &&
        cdef.includes("auth.uid()") &&
        cdef.includes("'role.created'")
          ? "PASS"
          : "FAIL",
    });

    const updateDef = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.update_organization_role(uuid, uuid, text, text, uuid, text[])'::regprocedure) as def`,
    );
    const udef = String(updateDef.rows[0]?.def ?? "");
    cases.push({
      id: "rpc_update_single_audit",
      status: udef.includes("'role.updated'") && !udef.includes("role.permissions_changed") ? "PASS" : "FAIL",
    });
    cases.push({
      id: "rpc_cross_org",
      status: udef.includes("organization_id is distinct from p_organization_id") ? "PASS" : "FAIL",
    });

    const helperAcl = await client.query<{
      proname: string;
      acl: string | null;
      auth_exec: boolean;
      anon_exec: boolean;
    }>(
      `select p.proname, p.proacl::text as acl,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'assert_custom_role_permission_set',
           'assert_can_manage_custom_roles',
           'replace_custom_role_permissions',
           'system_role_ddl_allowed'
         )
       order by 1`,
    );
    console.log("helper_acls", helperAcl.rows);
    cases.push({
      id: "helpers_not_granted_authenticated",
      status: helperAcl.rows.every((row) => row.auth_exec === false && row.anon_exec === false)
        ? "PASS"
        : "FAIL",
      detail: helperAcl.rows
        .map((r) => `${r.proname}:auth=${r.auth_exec}:anon=${r.anon_exec}:${r.acl ?? "null"}`)
        .join(" | "),
    });

    const fnMeta = await client.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'create_organization_role',
           'update_organization_role',
           'set_organization_role_active',
           'assert_can_manage_custom_roles',
           'assert_custom_role_permission_set',
           'replace_custom_role_permissions',
           'system_role_ddl_allowed'
         )
       order by 1`,
    );
    console.log("fn_meta", fnMeta.rows);

    const bypassDef = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.system_role_ddl_allowed()'::regprocedure) as def`,
    );
    const bdef = String(bypassDef.rows[0]?.def ?? "");
    console.log("system_role_ddl_allowed_def", bdef);
    cases.push({
      id: "ddl_bypass_requires_privileged_current_user",
      status:
        bdef.includes("current_user <> 'postgres'") &&
        bdef.includes("supabase_admin") &&
        bdef.includes("allow_system_role_ddl")
          ? "PASS"
          : "FAIL",
    });

    const assertDef = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.assert_custom_role_permission_set(uuid, text[])'::regprocedure) as def`,
    );
    const adef = String(assertDef.rows[0]?.def ?? "");
    cases.push({
      id: "rpc_non_delegable_in_assert",
      status: adef.includes("ROLE_PERMISSION_NON_DELEGABLE") && adef.includes("non_delegable_permission_keys")
        ? "PASS"
        : "FAIL",
    });

    const activeDef = await client.query<{ def: string }>(
      `select pg_get_functiondef('public.set_organization_role_active(uuid, uuid, boolean)'::regprocedure) as def`,
    );
    const sdef = String(activeDef.rows[0]?.def ?? "");
    cases.push({
      id: "rpc_deactivate_reactivate_audit",
      status: sdef.includes("'role.deactivated'") && sdef.includes("'role.reactivated'") ? "PASS" : "FAIL",
    });
    cases.push({
      id: "rpc_create_org_owned",
      status: cdef.includes("assert_can_manage_custom_roles") && udef.includes("organization_id is distinct from p_organization_id")
        ? "PASS"
        : "FAIL",
    });

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

    try {
      await run("sys_mut", async () => {
        await client.query(`update public.roles set name_en = name_en || 'x' where code = 'employee' and organization_id is null`);
      });
      cases.push({ id: "system_role_immutable_without_guc", status: "FAIL", detail: "update succeeded" });
    } catch (e) {
      cases.push({
        id: "system_role_immutable_without_guc",
        status: String(errMsg(e)).includes("SYSTEM_ROLE_IMMUTABLE") ? "PASS" : "FAIL",
        detail: errMsg(e).slice(0, 160),
      });
    }

    try {
      await run("guc_only", async () => {
        await client.query("select set_config('master_touch.allow_system_role_ddl', 'on', true)");
        await client.query(`update public.roles set name_en = name_en where code = 'employee' and organization_id is null`);
      });
      cases.push({ id: "ddl_bypass_postgres_plus_guc", status: "PASS" });
    } catch (e) {
      cases.push({
        id: "ddl_bypass_postgres_plus_guc",
        status: "FAIL",
        detail: errMsg(e).slice(0, 160),
      });
    }

    try {
      await run("auth_bypass", async () => {
        await client.query("set local role authenticated");
        await client.query("select set_config('master_touch.allow_system_role_ddl', 'on', true)");
        const allowed = await client.query<{ ok: boolean }>("select public.system_role_ddl_allowed() as ok");
        if (allowed.rows[0]?.ok === true) {
          throw new Error("authenticated ddl allowed true");
        }
        await client.query(
          `update public.roles set name_en = name_en || 'y' where code = 'employee' and organization_id is null`,
        );
      });
      cases.push({
        id: "authenticated_bypass",
        status: "FAIL",
        detail: "authenticated update of system role succeeded",
      });
    } catch (e) {
      const msg = errMsg(e);
      if (msg.includes("authenticated ddl allowed true")) {
        cases.push({ id: "authenticated_bypass", status: "FAIL", detail: msg });
      } else {
        cases.push({
          id: "authenticated_bypass",
          status: "NOT LIVE-CERTIFIED",
          detail: `No JWT session; SET ROLE authenticated evidence: ${msg.slice(0, 180)}`,
        });
      }
    }

    await client.query("rollback");

    const custom = await client.query<{ n: number }>(
      `select count(*)::int as n from public.roles where organization_id is not null or not is_system`,
    );
    cases.push({ id: "no_persistent_custom_role", status: custom.rows[0]?.n === 0 ? "PASS" : "FAIL" });

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
