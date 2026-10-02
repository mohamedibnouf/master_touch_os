#!/usr/bin/env node
/** Read-only baseline before 071 apply. Never writes. Never logs mailbox/secrets. */
import { connect, identityOk, ORG, EIGHT, EXPECTED_REF, FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071 } from "./phase5-db-gate";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    console.log("expected_ref", EXPECTED_REF);
    console.log("org", ORG);
    const host = (() => {
      const raw = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
      try {
        return new URL(raw.replace(/^postgres(ql)?:/, "https:")).hostname;
      } catch {
        return "unparsed";
      }
    })();
    console.log("db_host_contains_ref", host.includes(EXPECTED_REF));
    const mig = await client.query(
      "select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by 1 order by 1",
      [[FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071]],
    );
    console.log("migration_counts", mig.rows);
    const col = await client.query(
      `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='organizations' and column_name='management_notification_email') as exists`,
    );
    console.log("column_exists", col.rows[0]);
    const counts = await client.query(`
      select
        (select count(*)::int from public.organizations) as organizations,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from public.organization_members) as organization_members,
        (select count(*)::int from public.employees) as employees,
        (select count(*)::int from public.roles) as roles,
        (select count(*)::int from public.permissions) as permissions,
        (select count(*)::int from public.role_permissions) as role_permissions,
        (select count(*)::int from public.user_roles) as user_roles,
        (select count(*)::int from public.job_titles) as job_titles,
        (select count(*)::int from public.departments) as departments,
        (select count(*)::int from public.notifications) as notifications,
        (select count(*)::int from public.notification_deliveries) as notification_deliveries,
        (select count(*)::int from public.notification_preferences) as notification_preferences,
        (select count(*)::int from public.audit_logs) as audit_logs
    `);
    console.log("counts", counts.rows[0]);
    const eight = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.code='employee' and r.organization_id is null`,
    );
    const viewer = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.code='viewer' and rp.permission_key='role.read'`,
    );
    console.log("employee_eight", eight.rows[0], "expected", EIGHT.length);
    console.log("viewer_role_read", viewer.rows[0]);
    const orgN = await client.query(`select count(*)::int as n from public.organizations where id=$1`, [ORG]);
    console.log("target_org_count", orgN.rows[0]);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
