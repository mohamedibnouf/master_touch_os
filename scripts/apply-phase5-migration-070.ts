#!/usr/bin/env node
/**
 * Apply 070 via DATABASE_URL. Identity-gated. Never logs secrets.
 * Stops if 070 is already recorded. Does not rerun 067/068/069.
 */
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  FILE_067,
  FILE_068,
  FILE_069,
  FILE_070,
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
    if ((await countFile(client, FILE_070)) !== 0) {
      console.error("STOP: migration 070 already recorded.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_069)) !== 1) {
      console.error("STOP: migration 069 must exist exactly once.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_068)) !== 1 || (await countFile(client, FILE_067)) !== 1) {
      console.error("STOP: 067/068 must exist exactly once.");
      process.exit(2);
    }

    const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE_070);
    const sql = fs.readFileSync(migrationPath, "utf8");
    if (
      /create or replace function|insert into|update public\.|delete from public\.|drop table|truncate /i.test(
        sql,
      ) ||
      !sql.includes("revoke all on function public.replace_custom_role_permissions(uuid, text[])") ||
      !sql.includes("grant execute on function public.create_organization_role") ||
      !sql.includes("grant execute on function public.has_permission")
    ) {
      console.error("STOP: 070 SQL failed integrity review.");
      process.exit(2);
    }

    console.log(`apply ${FILE_070}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_070]);
      await client.query("commit");
      console.log(`ok ${FILE_070}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_070}`, err instanceof Error ? err.message : "error");
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
