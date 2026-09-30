#!/usr/bin/env node
/** Apply 065 via DATABASE_URL. Identity-gated. Never logs secrets. */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const EXPECTED_REF = "xjwhnxjdcrcmsxjjstsh";
const FILE = "065_phase5_document_drive_dual_source.sql";
const FILE_064 = "064_phase5_multi_workplace_attendance.sql";

function assertTargetIdentity(): void {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let ref: string | null = null;
  try {
    const host = new URL(publicUrl).hostname;
    ref = host.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null;
  } catch {
    ref = null;
  }
  if (ref !== EXPECTED_REF) {
    console.error("STOP: Supabase project ref mismatch.");
    process.exit(2);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const parsed = new URL(dbUrl);
  const hostOk = parsed.hostname.includes(EXPECTED_REF);
  const userOk = parsed.username === "postgres" || decodeURIComponent(parsed.username).includes(EXPECTED_REF);
  if (!hostOk && !userOk) {
    console.error("STOP: DATABASE_URL does not match expected project.");
    process.exit(2);
  }
}

async function connect(): Promise<pg.Client> {
  const dbUrl = process.env.DATABASE_URL!;
  const parsed = new URL(dbUrl);
  const password = decodeURIComponent(parsed.password);
  const candidates = [
    dbUrl,
    `postgresql://postgres.${EXPECTED_REF}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  ];
  for (const url of candidates) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      return client;
    } catch {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error("NO_DB_CONNECT");
}

async function main() {
  assertTargetIdentity();
  const client = await connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default timezone('utc', now())
    );
  `);

  const already065 = await client.query("select 1 from public.schema_migrations where filename = $1", [FILE]);
  if (already065.rows.length) {
    console.log(`skip ${FILE} (already applied)`);
    await client.end();
    return;
  }

  const has064 = await client.query(
    `select 1 from pg_constraint where conname = 'employee_workplace_assignments_no_overlap_per_site'`,
  );
  if (!has064.rows.length) {
    console.error("STOP: migration 064 catalog objects not found.");
    await client.end();
    process.exit(2);
  }

  const migrationPath = path.join(process.cwd(), "supabase", "migrations", FILE);
  const sql = fs.readFileSync(migrationPath, "utf8");

  console.log(`apply ${FILE}...`);
  try {
    await client.query("begin");
    await client.query("insert into public.schema_migrations (filename) values ($1) on conflict do nothing", [
      FILE_064,
    ]);
    await client.query(sql);
    await client.query("insert into public.schema_migrations (filename) values ($1)", [FILE]);
    await client.query("commit");
    console.log(`ok ${FILE}`);
  } catch (err) {
    await client.query("rollback");
    console.error(`FAIL ${FILE}`, err instanceof Error ? err.message : "error");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
