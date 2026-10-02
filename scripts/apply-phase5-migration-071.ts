#!/usr/bin/env node
/**
 * Apply 071 via DATABASE_URL. Identity-gated. SHA-256 gated. Never logs secrets.
 * Does not rerun 066–070. Does not set management_notification_email.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  connect,
  identityOk,
  FILE_066,
  FILE_067,
  FILE_068,
  FILE_069,
  FILE_070,
  FILE_071,
} from "./phase5-db-gate";

const EXPECTED_SHA = "4aaced85bf8eb0eaabc7e65604876b59bacf7b6105205f2b857cc5dc7e61e1f7";

async function countFile(client: import("pg").Client, filename: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from public.schema_migrations where filename = $1",
    [filename],
  );
  return r.rows[0]?.n ?? 0;
}

async function main() {
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE_071);
  const buf = fs.readFileSync(migrationPath);
  const sha = createHash("sha256").update(buf).digest("hex");
  console.log("sha256", sha);
  if (sha !== EXPECTED_SHA) {
    console.error("STOP: 071 SHA-256 mismatch.");
    process.exit(2);
  }

  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }
    if ((await countFile(client, FILE_071)) !== 0) {
      console.error("STOP: migration 071 already recorded.");
      process.exit(2);
    }
    for (const f of [FILE_066, FILE_067, FILE_068, FILE_069, FILE_070]) {
      const n = await countFile(client, f);
      if (n !== 1) {
        console.error(`STOP: ${f} must exist exactly once.`, n);
        process.exit(2);
      }
    }

    const sql = buf.toString("utf8");
    if (
      sql.includes("delete from public.") ||
      sql.includes("truncate ") ||
      !sql.includes("protect_management_notification_email") ||
      !sql.includes("document_lifecycle_trusted_session()") ||
      !sql.includes("has_permission('settings.manage', new.id)")
    ) {
      console.error("STOP: 071 SQL failed integrity review.");
      process.exit(2);
    }

    const col = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema='public' and table_name='organizations' and column_name='management_notification_email'
       ) as exists`,
    );
    if (col.rows[0]?.exists) {
      console.error("STOP: management_notification_email already exists.");
      process.exit(2);
    }

    console.log(`apply ${FILE_071}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE_071]);
      await client.query("commit");
      console.log(`ok ${FILE_071}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`FAIL ${FILE_071}`, err instanceof Error ? err.message : "error");
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
