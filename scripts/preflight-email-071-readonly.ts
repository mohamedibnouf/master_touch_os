#!/usr/bin/env node
/** Read-only 071 pre-apply counts. Never writes. Never logs mailbox values. */
import { connect, identityOk, ORG, FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071 } from "./phase5-db-gate";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);
    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations where filename in ($1,$2,$3,$4,$5,$6) group by filename order by 1",
      [FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071],
    );
    console.log("migration_counts", mig.rows);
    const col = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'organizations' and column_name = 'management_notification_email'
       ) as exists`,
    );
    console.log("management_notification_email_column", col.rows[0]);
    const orgs = await client.query(
      `select count(*)::int as organizations,
              count(*) filter (where id = $1)::int as target_org
       from public.organizations`,
      [ORG],
    );
    console.log("organizations", orgs.rows[0]);
    const notes = await client.query(`select count(*)::int as n from public.notifications where organization_id = $1`, [ORG]);
    const dels = await client.query(
      `select status, count(*)::int as n from public.notification_deliveries where organization_id = $1 group by status order by 1`,
      [ORG],
    );
    const prefs = await client.query(
      `select count(*)::int as n from public.notification_preferences where organization_id = $1`,
      [ORG],
    );
    console.log("notifications", notes.rows[0]);
    console.log("deliveries_by_status", dels.rows);
    console.log("notification_preferences", prefs.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
