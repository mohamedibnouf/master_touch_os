#!/usr/bin/env node
/** Read-only 066 preflight. Never logs secrets. */
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const EXPECTED_REF = "xjwhnxjdcrcmsxjjstsh";
const ORG = "11111111-1111-1111-1111-111111111111";

function assertTargetIdentity(): URL {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let ref: string | null = null;
  try {
    ref = new URL(publicUrl).hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null;
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
  return parsed;
}

async function connect(): Promise<pg.Client> {
  assertTargetIdentity();
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
  const client = await connect();
  const ident = await client.query("select current_database() as db, current_user as usr");
  console.log("identity.db", ident.rows[0]?.db);
  console.log("identity.user", ident.rows[0]?.usr === "postgres" || String(ident.rows[0]?.usr).includes(EXPECTED_REF) ? "expected_admin" : "UNEXPECTED");

  const org = await client.query("select id, name_ar from public.organizations where id = $1", [ORG]);
  console.log("org_present", org.rows.length === 1);

  const mig = await client.query("select filename from public.schema_migrations order by filename");
  console.log(
    "schema_migrations",
    mig.rows.map((r) => r.filename),
  );

  const counts = await client.query(`
    select
      (select count(*)::int from public.documents) as documents,
      (select count(*)::int from public.document_versions) as document_versions,
      (select count(*)::int from public.document_intelligence) as document_intelligence,
      (select count(*)::int from public.entity_documents) as entity_documents,
      (select count(*)::int from public.employee_documents) as employee_documents,
      (select count(*)::int from public.audit_logs) as audit_logs
  `);
  console.log("counts", counts.rows[0]);

  const cols = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name in ('archived_at', 'archived_by')
    order by 1
  `);
  console.log("archive_columns", cols.rows.map((r) => r.column_name));

  const bucket = await client.query(`select id, public from storage.buckets where id = 'documents'`);
  console.log("documents_bucket_private", bucket.rows[0]?.public === false);

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
