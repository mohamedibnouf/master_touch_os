#!/usr/bin/env node
/**
 * Apply 068 via DATABASE_URL. Identity-gated. Never logs secrets. Not an npm hook.
 * Stops if 068 is already recorded. Production Master Touch already has 068 = 1 —
 * do not run this script against that database. Canonical SQL is in
 * supabase/migrations/068_job_titles.sql (corrected RAISE; no USING message).
 */
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  FILE_065,
  FILE_066,
  FILE_067,
  FILE_068,
  EIGHT,
} from "./phase5-db-gate";

async function countFile(client: import("pg").Client, filename: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from public.schema_migrations where filename = $1",
    [filename],
  );
  return r.rows[0]?.n ?? 0;
}

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_068)) !== 0) {
      console.error("STOP: migration 068 already recorded.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_067)) !== 1) {
      console.error("STOP: migration 067 must exist exactly once.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_066)) !== 1) {
      console.error("STOP: migration 066 must exist exactly once.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_065)) !== 1) {
      console.error("STOP: migration 065 must exist exactly once.");
      process.exit(2);
    }

    const grants = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null`,
    );
    if (grants.rows[0]?.n !== 8) {
      console.error("STOP: employee role grant count is not 8.");
      process.exit(2);
    }
    const eight = await client.query(
      `select count(*)::int as n
       from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null
         and rp.permission_key = any($1::text[])`,
      [EIGHT],
    );
    if (eight.rows[0]?.n !== 8) {
      console.error("STOP: certified employee eight permissions missing.");
      process.exit(2);
    }

    const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE_068);
    const sql = fs.readFileSync(migrationPath, "utf8");
    if (
      /delete from public\.employees|truncate |drop table|drop column|update public\.employees|insert into public\.user_roles|insert into public\.job_titles \(/i.test(
        sql,
      )
    ) {
      console.error("STOP: 068 SQL failed destructive/business-row review.");
      process.exit(2);
    }

    console.log(`apply ${FILE_068}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_068]);
      await client.query("commit");
      console.log(`ok ${FILE_068}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_068}`, err instanceof Error ? err.message : "error");
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
