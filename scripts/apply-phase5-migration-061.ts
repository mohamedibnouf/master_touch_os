#!/usr/bin/env node
/** Apply migration 061_phase5_document_intelligence.sql via DATABASE_URL */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const FILE = "061_phase5_document_intelligence.sql";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default timezone('utc', now())
    );
  `);

  const { rows } = await client.query(
    "select 1 from public.schema_migrations where filename = $1",
    [FILE],
  );
  if (rows.length) {
    console.log(`skip ${FILE} (already applied)`);
    await client.end();
    return;
  }

  // Prefer idempotent apply script when present
  const applyPath = path.join(process.cwd(), "supabase", "phase5_apply_061.sql");
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE);
  const sql = fs.existsSync(applyPath)
    ? fs.readFileSync(applyPath, "utf8")
    : fs.readFileSync(migrationPath, "utf8");

  console.log(`apply ${FILE}...`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE]);
    await client.query("commit");
    console.log(`ok ${FILE}`);
  } catch (err) {
    await client.query("rollback");
    console.error(`FAIL ${FILE}`, err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
