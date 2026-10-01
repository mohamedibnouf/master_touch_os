#!/usr/bin/env node
/** Apply 067 via DATABASE_URL. Identity-gated. Never logs secrets. */
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  FILE_065,
  FILE_066,
  FILE_067,
  EMPLOYEE_ROLE_ID,
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

    if ((await countFile(client, FILE_067)) !== 0) {
      console.error("STOP: migration 067 already recorded.");
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

    const idTaken = await client.query("select 1 from public.roles where id = $1", [EMPLOYEE_ROLE_ID]);
    if (idTaken.rows.length) {
      console.error("STOP: employee role id already exists.");
      process.exit(2);
    }
    const codeTaken = await client.query("select 1 from public.roles where code = 'employee'");
    if (codeTaken.rows.length) {
      console.error("STOP: role code employee already exists.");
      process.exit(2);
    }

    const perms = await client.query(
      "select count(*)::int as n from public.permissions where key = any($1::text[])",
      [EIGHT],
    );
    if (perms.rows[0]?.n !== 8) {
      console.error("STOP: required self-service permissions are missing.");
      process.exit(2);
    }

    const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE_067);
    const sql = fs.readFileSync(migrationPath, "utf8");
    if (/delete from|truncate |drop table|drop column|update public\.roles|insert into public\.user_roles/i.test(sql)) {
      console.error("STOP: 067 SQL failed destructive-pattern review.");
      process.exit(2);
    }

    console.log(`apply ${FILE_067}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_067]);
      await client.query("commit");
      console.log(`ok ${FILE_067}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_067}`, err instanceof Error ? err.message : "error");
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
