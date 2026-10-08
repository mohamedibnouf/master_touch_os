#!/usr/bin/env node
/** Read-only 084 preflight. Never writes. Never applies. Never logs secrets. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const FILES = [
  "010_functions_rls.sql",
  "062_phase5_notification_communication_hub.sql",
  "069_organization_custom_roles.sql",
  "071_organization_management_notification_email.sql",
  "075_ai_intelligence_platform.sql",
  "083_project_commissioning_handover.sql",
  "084_ai_findings_guardian.sql",
];

const PERMS = [
  "reports.management.read",
  "ai.management.view",
  "settings.manage",
  "payroll.view_all",
  "payroll.review",
  "payroll.approve",
  "payroll.prepare",
  "employee.manage",
  "employee_compliance.read",
  "employee_contract.read",
  "attendance.view_all",
  "attendance.manage",
  "leave.view_all",
  "leave.manage",
];

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query<{ filename: string; n: number }>(
      `select filename, count(*)::int as n
       from public.schema_migrations
       where filename = any($1::text[])
       group by 1
       order by 1`,
      [FILES],
    );
    console.log("migration_counts", mig.rows);
    const migLike = await client.query<{ filename: string }>(
      `select filename from public.schema_migrations
       where filename like '%010%'
          or filename like '%062%'
          or filename like '%083%'
          or filename like '%084%'
       order by 1`,
    );
    console.log("migration_filename_like", migLike.rows);
    const migTotal = await client.query<{ n: number }>(`select count(*)::int as n from public.schema_migrations`);
    console.log("schema_migrations_total", migTotal.rows[0]?.n);

    const tables = await client.query<{ relname: string; exists: boolean }>(
      `select relname, true as exists
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and relname = any($1::text[])
         and relkind = 'r'
       order by 1`,
      [["organizations", "profiles", "notification_job_runs", "audit_logs", "role_permissions", "permissions", "ai_findings", "ai_guardian_settings"]],
    );
    console.log("tables", tables.rows);

    const jobCols = await client.query<{ column_name: string; data_type: string; udt_name: string }>(
      `select column_name, data_type, udt_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'notification_job_runs'
         and column_name in ('id','job_name','window_key','status','details','heartbeat_at','started_at','finished_at','error_code')
       order by 1`,
    );
    console.log("notification_job_runs_columns", jobCols.rows);

    const uniq = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'notification_job_runs'`,
    );
    console.log("notification_job_runs_indexes", uniq.rows.map((r) => r.indexdef));

    const fns = await client.query<{
      proname: string;
      args: string;
      security_definer: boolean;
      config: string[] | null;
      auth_exec: boolean;
      anon_exec: boolean;
    }>(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as args,
              p.prosecdef as security_definer,
              p.proconfig as config,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any($1::text[])
       order by 1, 2`,
      [["has_permission", "is_organization_member", "log_audit", "can_read_ai_finding", "review_ai_finding", "claim_guardian_job", "enable_guardian_alerts"]],
    );
    console.log(
      "functions",
      fns.rows.map((r) => ({
        name: r.proname,
        args: r.args,
        security_definer: r.security_definer,
        search_path: r.config,
        auth_exec: r.auth_exec,
        anon_exec: r.anon_exec,
      })),
    );

    const perms = await client.query<{ key: string; present: boolean }>(
      `select p.key, true as present
       from public.permissions p
       where p.key = any($1::text[])
       order by 1`,
      [PERMS],
    );
    console.log("permission_keys", perms.rows);

    const org = await client.query<{ n: number }>(`select count(*)::int as n from public.organizations where id = $1`, [ORG]);
    console.log("canonical_org", org.rows[0]?.n === 1);

    const rlsJob = await client.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and relname='notification_job_runs'`,
    );
    console.log("notification_job_runs_rls", rlsJob.rows[0]?.relrowsecurity === true);

    await client.query("begin");
    await client.query("set local role authenticated");
    const guc = await client.query<{ v: string }>(
      `select set_config('ai.guardian.mutating', 'review', true) as v`,
    );
    await client.query("rollback");
    console.log("authenticated_can_set_custom_guc", guc.rows[0]?.v === "review");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
