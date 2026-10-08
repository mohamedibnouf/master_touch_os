#!/usr/bin/env node
/** Post-apply 084 security checks. Synthetic findings only. Rolls back. No scan/alerts. */
import { connect, identityOk, ORG } from "./phase5-db-gate";

const SRC_OPS = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const SRC_HR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const SRC_PAY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const FIND_OPS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const FIND_HR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
const FIND_PAY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";

type Flags = { profile_id: string; mgmt: boolean; payroll: boolean; hr: boolean };

async function asUser(client: import("pg").Client, profileId: string, role: "authenticated" | "anon") {
  await client.query(
    `select set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claim.role', $2, true),
            set_config('request.jwt.claims', $3, true)`,
    [profileId, role, JSON.stringify({ sub: profileId, role, aud: role })],
  );
  await client.query(`set local role ${role}`);
}

async function resetRole(client: import("pg").Client) {
  await client.query("reset role");
}

async function withSavepoint<T>(client: import("pg").Client, name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  await client.query(`savepoint ${name}`);
  try {
    const out = await fn();
    await client.query(`release savepoint ${name}`);
    return out;
  } catch (e) {
    await client.query(`rollback to savepoint ${name}`);
    return { error: e instanceof Error ? e.message.slice(0, 160) : "error" };
  }
}

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);

    const leftover = await client.query<{ n: number }>(
      `select count(*)::int as n from public.ai_findings where id = any($1::uuid[])`,
      [[FIND_OPS, FIND_HR, FIND_PAY]],
    );
    console.log("leftover_synthetic", leftover.rows[0]?.n ?? -1);

    const recorded = await client.query<{ n: number }>(
      `select count(*)::int as n from public.schema_migrations where filename = '084_ai_findings_guardian.sql'`,
    );
    console.log("schema_migrations_084", recorded.rows[0]?.n);

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
    const noMgmt = flags.rows.find((r) => !r.mgmt) ?? null;
    const pay = flags.rows.find((r) => r.mgmt && r.payroll) ?? null;
    const mgmtOnly = flags.rows.find((r) => r.mgmt && !r.payroll && !r.hr) ?? null;
    const hrNoPay = flags.rows.find((r) => r.mgmt && r.hr && !r.payroll) ?? null;
    console.log("persona_available", {
      no_mgmt: Boolean(noMgmt),
      mgmt_only: Boolean(mgmtOnly),
      hr_no_payroll: Boolean(hrNoPay),
      payroll: Boolean(pay),
    });

    await client.query("begin");
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

    if (noMgmt) {
      await asUser(client, noMgmt.profile_id, "authenticated");
      const vis = await client.query<{ n: number }>(
        `select count(*)::int as n from public.ai_findings where id = any($1::uuid[])`,
        [[FIND_OPS, FIND_HR, FIND_PAY]],
      );
      results.non_mgmt_count = vis.rows[0]?.n;
      await resetRole(client);
    }

    if (pay) {
      await asUser(client, pay.profile_id, "authenticated");
      const vis = await client.query<{ category: string }>(
        `select category from public.ai_findings where id = any($1::uuid[]) order by category`,
        [[FIND_OPS, FIND_HR, FIND_PAY]],
      );
      results.payroll_categories = vis.rows.map((r) => r.category);
      const upd = await withSavepoint(client, "upd", async () => {
        const r = await client.query(`update public.ai_findings set severity = 'LOW' where id = $1 returning id`, [FIND_OPS]);
        return r.rowCount ?? 0;
      });
      results.direct_update = upd;
      const rpcPay = await withSavepoint(client, "rpc_pay", async () => {
        await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_PAY]);
        return "ok";
      });
      results.review_payroll = rpcPay;
      const rpcBad = await withSavepoint(client, "rpc_bad", async () => {
        await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_PAY]);
        return "ok";
      });
      results.review_payroll_second = rpcBad;
      const audit = await client.query<{ n: number }>(
        `select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'guardian.finding.status'`,
        [FIND_PAY],
      );
      results.audit_count = audit.rows[0]?.n;
      const evidenceLeak = JSON.stringify(rpcPay).match(/iban|salary|net_pay|iqama/i);
      results.rpc_error_has_sensitive = Boolean(evidenceLeak);
      await resetRole(client);
    }

    await client.query(
      `select set_config('request.jwt.claim.sub', '', true),
              set_config('request.jwt.claim.role', 'anon', true),
              set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ role: "anon", aud: "anon" })],
    );
    const anonSel = await withSavepoint(client, "anon_sel", async () => {
      await client.query("set local role anon");
      const r = await client.query(`select count(*)::int as n from public.ai_findings`);
      return r.rows[0]?.n;
    });
    results.anon_select = anonSel;
    const anonRpc = await withSavepoint(client, "anon_rpc", async () => {
      await client.query("set local role anon");
      await client.query(`select public.review_ai_finding($1, 'acknowledged', null)`, [FIND_OPS]);
      return "ok";
    });
    results.anon_review = anonRpc;
    await resetRole(client);

    const enableNoBaseline = await withSavepoint(client, "enable", async () => {
      if (!pay) return "skip";
      await asUser(client, pay.profile_id, "authenticated");
      await client.query(`select public.enable_guardian_alerts($1)`, [ORG]);
      return "ok";
    });
    results.enable_without_baseline = enableNoBaseline;

    const settings = await client.query<{ n: number; on: number }>(
      `select count(*)::int as n, count(*) filter (where alerts_enabled)::int as on
       from public.ai_guardian_settings`,
    );
    results.settings_rows_in_txn = settings.rows[0];

    console.log("live_security", results);
    await client.query("rollback");
    console.log("security_fixtures_rolled_back", true);

    const leftoverAfter = await client.query<{ n: number }>(
      `select count(*)::int as n from public.ai_findings where id = any($1::uuid[])`,
      [[FIND_OPS, FIND_HR, FIND_PAY]],
    );
    console.log("leftover_after_rollback", leftoverAfter.rows[0]?.n);

    if ((leftoverAfter.rows[0]?.n ?? 0) !== 0) {
      console.error("STOP: synthetic findings remain");
      process.exit(2);
    }
    if (results.non_mgmt_count !== 0 && noMgmt) {
      console.error("STOP: non-management read findings");
      process.exit(2);
    }
    if (results.direct_update !== undefined && typeof results.direct_update === "number") {
      console.error("STOP: authenticated UPDATE wrote rows");
      process.exit(2);
    }
    if (results.anon_review === "ok") {
      console.error("STOP: anon executed review");
      process.exit(2);
    }
    if (results.enable_without_baseline === "ok") {
      console.error("STOP: alerts enabled without baseline");
      process.exit(2);
    }
    if (results.rpc_error_has_sensitive) {
      console.error("STOP: sensitive tokens in RPC error");
      process.exit(2);
    }
    console.log("live_security_ok", true);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
