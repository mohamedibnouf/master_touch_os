#!/usr/bin/env node
/** Apply 084 once. Identity-gated. Hash-gated. Does not deploy, scan, or enable alerts. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connect, identityOk, ORG, EXPECTED_REF } from "./phase5-db-gate";

const FILE = "084_ai_findings_guardian.sql";
const EXPECTED_SHA256 = "3CB593911ABAD5992A8D64BE2F4CABB794834F6AE06D3D23475918DAB3B5A5F3";

const SRC_OPS = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const SRC_HR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const SRC_PAY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const FIND_OPS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const FIND_HR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
const FIND_PAY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";

type Flags = {
  profile_id: string;
  mgmt: boolean;
  payroll: boolean;
  hr: boolean;
};

async function asUser(client: import("pg").Client, profileId: string, role: "authenticated" | "anon") {
  const claims = JSON.stringify({ sub: profileId, role, aud: role });
  await client.query(
    `select set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claim.role', $2, true),
            set_config('request.jwt.claims', $3, true)`,
    [profileId, role, claims],
  );
  await client.query(`set local role ${role}`);
}

async function resetRole(client: import("pg").Client) {
  await client.query("reset role");
  await client.query(`select set_config('request.jwt.claim.sub', '', true),
                             set_config('request.jwt.claim.role', '', true),
                             set_config('request.jwt.claims', '{}', true)`);
}

async function main() {
  const filePath = path.join(process.cwd(), "supabase", "migrations", FILE);
  const buf = fs.readFileSync(filePath);
  const sha = createHash("sha256").update(buf).digest("hex").toUpperCase();
  console.log("file", FILE);
  console.log("sha256", sha);
  console.log("expected_sha256", EXPECTED_SHA256);
  if (sha !== EXPECTED_SHA256) {
    console.error("STOP: SHA-256 mismatch.");
    process.exit(2);
  }
  const sql = buf.toString("utf8");
  if (!sql.includes("lease_generation") || sql.includes("ai.guardian.mutating")) {
    console.error("STOP: 084 failed integrity review.");
    process.exit(2);
  }

  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);

    const ident = await client.query<{ db: string; usr: string }>("select current_database() as db, current_user as usr");
    console.log("target_ref", EXPECTED_REF);
    console.log("connected_db", ident.rows[0]?.db);

    const already = await client.query<{ n: number }>(
      "select count(*)::int as n from public.schema_migrations where filename = $1",
      [FILE],
    );
    console.log("schema_migrations_084", already.rows[0]?.n ?? 0);
    if ((already.rows[0]?.n ?? 0) !== 0) {
      console.error("STOP: 084 already recorded.");
      process.exit(2);
    }

    const existing = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname in ('ai_findings', 'ai_guardian_settings')`,
    );
    console.log("guardian_tables_before", existing.rows[0]?.n ?? 0);
    if ((existing.rows[0]?.n ?? 0) !== 0) {
      console.error("STOP: Guardian tables already exist.");
      process.exit(2);
    }

    console.log("apply", FILE);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE]);
      await client.query("commit");
      console.log("apply_ok", FILE);
    } catch (err) {
      await client.query("rollback");
      console.error("FAIL apply", err instanceof Error ? err.message : "error");
      process.exit(1);
    }

    const tables = await client.query<{ relname: string; rls: boolean }>(
      `select c.relname, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname in ('ai_findings','ai_guardian_settings')
       order by 1`,
    );
    console.log("tables_after", tables.rows);

    const cols = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='notification_job_runs'
         and column_name in ('details','heartbeat_at','lease_generation')
       order by 1`,
    );
    console.log("job_run_new_columns", cols.rows.map((r) => r.column_name));

    const fns = await client.query<{
      proname: string;
      args: string;
      prosecdef: boolean;
      auth_exec: boolean;
      anon_exec: boolean;
      service_exec: boolean;
    }>(
      `select p.proname,
              pg_get_function_identity_arguments(p.oid) as args,
              p.prosecdef,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname in (
         'has_management_ai_view','can_read_ai_finding','review_ai_finding',
         'enable_guardian_alerts','claim_guardian_job','guardian_commit_org_scan',
         'guardian_finish_job','guardian_mark_notified','protect_ai_findings_identity'
       )
       order by 1, 2`,
    );
    console.log(
      "functions",
      fns.rows.map((r) => ({
        name: r.proname,
        args: r.args,
        definer: r.prosecdef,
        auth_exec: r.auth_exec,
        anon_exec: r.anon_exec,
        service_exec: r.service_exec,
      })),
    );

    const grants = await client.query<{ grantee: string; privilege: string }>(
      `select grantee, privilege_type as privilege
       from information_schema.role_table_grants
       where table_schema='public' and table_name='ai_findings'
       order by 1, 2`,
    );
    console.log("ai_findings_grants", grants.rows);

    const pols = await client.query<{ polname: string; cmd: string; roles: string[] }>(
      `select pol.polname, pol.polcmd as cmd, pol.polroles::regrole[] as roles
       from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='ai_findings'`,
    );
    console.log(
      "ai_findings_policies",
      pols.rows.map((p) => ({ name: p.polname, cmd: p.cmd })),
    );

    const trig = await client.query<{ tgname: string }>(
      `select t.tgname from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='ai_findings' and not t.tgisinternal`,
    );
    console.log("ai_findings_triggers", trig.rows.map((r) => r.tgname));

    const recorded = await client.query<{ n: number }>(
      "select count(*)::int as n from public.schema_migrations where filename = $1",
      [FILE],
    );
    console.log("schema_migrations_084_after", recorded.rows[0]?.n);

    const flags = await client.query<Flags>(
      `select ur.profile_id::text as profile_id,
              bool_or(rp.permission_key in ('reports.management.read','ai.management.view')) as mgmt,
              bool_or(rp.permission_key in ('payroll.view_all','payroll.review','payroll.approve','payroll.prepare')) as payroll,
              bool_or(rp.permission_key in (
                'employee.manage','employee_compliance.read','employee_contract.read',
                'attendance.view_all','attendance.manage','leave.view_all','leave.manage'
              )) as hr
       from public.user_roles ur
       join public.role_permissions rp on rp.role_id = ur.role_id
       join public.organization_members m
         on m.profile_id = ur.profile_id and m.organization_id = ur.organization_id and m.status = 'active'
       join public.profiles p on p.id = ur.profile_id and p.is_active = true
       where ur.organization_id = $1
       group by ur.profile_id`,
      [ORG],
    );
    const mgmtOnly = flags.rows.find((r) => r.mgmt && !r.payroll && !r.hr) ?? null;
    const hrNoPay = flags.rows.find((r) => r.mgmt && r.hr && !r.payroll) ?? null;
    const pay = flags.rows.find((r) => r.mgmt && r.payroll) ?? null;
    const other = await client.query<{ profile_id: string }>(
      `select m.profile_id::text as profile_id
       from public.organization_members m
       join public.profiles p on p.id = m.profile_id and p.is_active = true
       where m.status = 'active' and m.organization_id <> $1
       limit 1`,
      [ORG],
    );
    console.log("persona_available", {
      mgmt_only: Boolean(mgmtOnly),
      hr_no_payroll: Boolean(hrNoPay),
      payroll: Boolean(pay),
      other_org: other.rows.length > 0,
    });

    await client.query("begin");
    try {
      await client.query(
        `insert into public.ai_findings (
           id, organization_id, source_type, source_id, rule_id, category, severity,
           title_ar, title_en, explanation_ar, explanation_en, evidence, dedup_key, detection_version, detector
         ) values
         ($1, $4, 'project', $5, 'TEST_OPS', 'PROJECT_DELAY', 'HIGH', 'اختبار', 'test', 'شرح', 'exp', '{}'::jsonb, 'test:ops', 'v1', 'rule'),
         ($2, $4, 'attendance_record', $6, 'TEST_HR', 'ATTENDANCE', 'HIGH', 'اختبار', 'test', 'شرح', 'exp', '{}'::jsonb, 'test:hr', 'v1', 'rule'),
         ($3, $4, 'payroll_period', $7, 'TEST_PAY', 'PAYROLL', 'HIGH', 'اختبار', 'test', 'شرح', 'exp', '{}'::jsonb, 'test:pay', 'v1', 'rule')`,
        [FIND_OPS, FIND_HR, FIND_PAY, ORG, SRC_OPS, SRC_HR, SRC_PAY],
      );

      const results: Record<string, unknown> = {};

      if (mgmtOnly) {
        await asUser(client, mgmtOnly.profile_id, "authenticated");
        const vis = await client.query<{ category: string }>(
          `select category from public.ai_findings where id = any($1::uuid[]) order by category`,
          [[FIND_OPS, FIND_HR, FIND_PAY]],
        );
        results.mgmt_only_categories = vis.rows.map((r) => r.category);
        const upd = await client.query(
          `update public.ai_findings set severity = 'LOW' where id = $1 returning id`,
          [FIND_OPS],
        ).catch((e: Error) => ({ rows: [], error: e.message.slice(0, 80) }));
        results.mgmt_only_direct_update = "error" in upd ? "denied" : (upd.rows.length === 0 ? "denied" : "UNEXPECTED_WRITE");
        const rpcPay = await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_PAY]).catch((e: Error) => e.message.slice(0, 120));
        results.mgmt_only_review_payroll = typeof rpcPay === "string" ? rpcPay : "UNEXPECTED_OK";
        await resetRole(client);
      }

      if (hrNoPay) {
        await asUser(client, hrNoPay.profile_id, "authenticated");
        const vis = await client.query<{ category: string }>(
          `select category from public.ai_findings where id = any($1::uuid[]) order by category`,
          [[FIND_OPS, FIND_HR, FIND_PAY]],
        );
        results.hr_categories = vis.rows.map((r) => r.category);
        await resetRole(client);
      }

      if (pay) {
        await asUser(client, pay.profile_id, "authenticated");
        const vis = await client.query<{ category: string }>(
          `select category from public.ai_findings where id = any($1::uuid[]) order by category`,
          [[FIND_OPS, FIND_HR, FIND_PAY]],
        );
        results.payroll_categories = vis.rows.map((r) => r.category);
        const rpc = await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_OPS]);
        results.payroll_review_ops = rpc.rowCount === 1 ? "ok" : "fail";
        const audit = await client.query<{ n: number }>(
          `select count(*)::int as n from public.audit_logs
           where entity_id = $1 and action = 'guardian.finding.status'`,
          [FIND_OPS],
        );
        results.audit_review = audit.rows[0]?.n === 1;
        await resetRole(client);
      }

      if (other.rows[0]) {
        await asUser(client, other.rows[0].profile_id, "authenticated");
        const vis = await client.query<{ n: number }>(
          `select count(*)::int as n from public.ai_findings where organization_id = $1`,
          [ORG],
        );
        results.other_org_count = vis.rows[0]?.n ?? -1;
        await resetRole(client);
      }

      await client.query(
        `select set_config('request.jwt.claim.sub', '', true),
                set_config('request.jwt.claim.role', 'anon', true),
                set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ role: "anon", aud: "anon" })],
      );
      await client.query("set local role anon");
      const anonSel = await client.query(`select count(*)::int as n from public.ai_findings`).catch((e: Error) => e.message.slice(0, 80));
      results.anon_select = typeof anonSel === "string" ? "denied_or_empty" : anonSel.rows[0];
      const anonRpc = await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_OPS]).catch((e: Error) => e.message.slice(0, 80));
      results.anon_review = typeof anonRpc === "string" ? "denied" : "UNEXPECTED_OK";
      await resetRole(client);

      const guc = await client.query<{ v: string }>(`select set_config('ai.guardian.mutating', 'review', true) as v`);
      results.guc_still_settable = guc.rows[0]?.v === "review";

      console.log("live_security", results);

      await client.query("rollback");
      console.log("security_fixtures_rolled_back", true);

      if (mgmtOnly && JSON.stringify(results.mgmt_only_categories) !== JSON.stringify(["PROJECT_DELAY"])) {
        console.error("STOP: management-only isolation failed", results.mgmt_only_categories);
        process.exit(2);
      }
      if (results.mgmt_only_direct_update === "UNEXPECTED_WRITE") {
        console.error("STOP: authenticated UPDATE succeeded");
        process.exit(2);
      }
      if (hrNoPay && Array.isArray(results.hr_categories) && (results.hr_categories as string[]).includes("PAYROLL")) {
        console.error("STOP: HR read payroll finding");
        process.exit(2);
      }
      if (pay && Array.isArray(results.payroll_categories) && !(results.payroll_categories as string[]).includes("PAYROLL")) {
        console.error("STOP: payroll persona missed payroll finding");
        process.exit(2);
      }
      if (other.rows.length > 0 && results.other_org_count !== 0) {
        console.error("STOP: cross-org SELECT leaked");
        process.exit(2);
      }
      if (results.anon_review !== "denied") {
        console.error("STOP: anon executed review RPC");
        process.exit(2);
      }
      console.log("live_security_ok", true);
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      console.error("FAIL security checks", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
