#!/usr/bin/env node
/** Read-only post-066 schema/count verification. Never logs secrets. */
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const EXPECTED_REF = "xjwhnxjdcrcmsxjjstsh";
const ORG = "11111111-1111-1111-1111-111111111111";

function assertTargetIdentity(): void {
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
  console.log(
    "identity.user",
    ident.rows[0]?.usr === "postgres" || String(ident.rows[0]?.usr).includes(EXPECTED_REF) ? "expected_admin" : "UNEXPECTED",
  );

  const mig = await client.query(
    "select filename, count(*)::int as n from public.schema_migrations group by filename order by filename",
  );
  console.log("schema_migrations", mig.rows);

  const cols = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name in ('archived_at', 'archived_by')
    order by 1
  `);
  console.log("archive_columns", cols.rows);

  const pair = await client.query(`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_archive_pair_chk'
  `);
  console.log("pair_constraint", pair.rows);

  const fk = await client.query(`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.documents'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%archived_by%'
  `);
  console.log("archived_by_fk", fk.rows);

  const idx = await client.query(`
    select indexname from pg_indexes
    where schemaname = 'public' and tablename = 'documents' and indexname = 'documents_org_archived_idx'
  `);
  console.log("archive_index", idx.rows.map((r) => r.indexname));

  const trg = await client.query(`
    select t.tgname, t.tgenabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'documents'
      and t.tgname = 'documents_protect_archive_fields' and not t.tgisinternal
  `);
  console.log("archive_trigger", trg.rows);

  const perm = await client.query(`select key from public.permissions where key = 'document.archive'`);
  console.log("permission", perm.rows.map((r) => r.key));

  const grants = await client.query(`
    select r.code
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where rp.permission_key = 'document.archive'
    order by r.code
  `);
  console.log("role_grants", grants.rows.map((r) => r.code));

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

  const lifecycle = await client.query(
    `select
       count(*)::int as total,
       count(*) filter (where archived_at is null and archived_by is null)::int as both_null,
       count(*) filter (where archived_at is not null or archived_by is not null)::int as any_set
     from public.documents
     where organization_id = $1`,
    [ORG],
  );
  console.log("existing_lifecycle", lifecycle.rows[0]);

  const bucket = await client.query(`select id, public from storage.buckets where id = 'documents'`);
  console.log("documents_bucket_private", bucket.rows[0]?.public === false);

  const fns = await client.query<{ proname: string; def: string }>(`
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('document_lifecycle_trusted_session', 'protect_document_archive_fields')
    order by p.proname
  `);
  const triggerFn = fns.rows.find((r) => r.proname === "protect_document_archive_fields")?.def ?? "";
  const trustedFn = fns.rows.find((r) => r.proname === "document_lifecycle_trusted_session")?.def ?? "";
  console.log("066_fn_consistency", {
    trusted_has_service_role: trustedFn.includes("service_role"),
    trusted_rejects_jwt_roles: trustedFn.includes("authenticated") && trustedFn.includes("anon"),
    trigger_has_archive_permission: triggerFn.includes("document.archive"),
    trigger_forbids_org_change: triggerFn.includes("organization_id"),
    uid_null_is_not_trusted_alone: !trustedFn.includes("auth.uid() is null") && triggerFn.includes("auth.uid() is null"),
  });

  const deletePolicies = await client.query(`
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where (schemaname = 'public' and tablename in ('documents', 'document_versions') and cmd = 'DELETE')
       or (schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE')
  `);
  console.log("delete_policies", deletePolicies.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
