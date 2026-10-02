#!/usr/bin/env node
/**
 * Apply 069 via DATABASE_URL. Identity-gated. Never logs secrets.
 * Stops if 069 is already recorded. Does not rerun 067/068.
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
  FILE_069,
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
    if ((await countFile(client, FILE_069)) !== 0) {
      console.error("STOP: migration 069 already recorded.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_068)) !== 1) {
      console.error("STOP: migration 068 must exist exactly once.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_067)) !== 1) {
      console.error("STOP: migration 067 must exist exactly once.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_066)) !== 1 || (await countFile(client, FILE_065)) !== 1) {
      console.error("STOP: 065/066 must exist exactly once.");
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
      process.exit(1);
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
      process.exit(1);
    }

    const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE_069);
    const sql = fs.readFileSync(migrationPath, "utf8");
    if (
      /truncate |drop table|drop column|insert into public\.user_roles|delete from public\.roles/i.test(sql) ||
      !sql.includes("add column if not exists is_active") ||
      !sql.includes("'role.manage'") ||
      !sql.includes("and r.code = 'viewer'")
    ) {
      console.error("STOP: 069 SQL failed integrity review.");
      process.exit(2);
    }

    const viewerPre = await client.query<{ permission_key: string }>(
      `select rp.permission_key from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
       where r.code = 'viewer' and r.organization_id is null order by 1`,
    );
    console.log("viewer_pre", viewerPre.rows.map((r) => r.permission_key));

    console.log(`apply ${FILE_069}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_069]);
      await client.query("commit");
      console.log(`ok ${FILE_069}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_069}`, err instanceof Error ? err.message : "error");
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
