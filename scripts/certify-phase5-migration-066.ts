#!/usr/bin/env node
/**
 * Non-destructive 066 live authorization certification.
 * All data mutations run inside a transaction that always ROLLBACKs.
 * Never logs secrets.
 */
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const EXPECTED_REF = "xjwhnxjdcrcmsxjjstsh";
const ORG = "11111111-1111-1111-1111-111111111111";
const FAKE_ORG = "22222222-2222-2222-2222-222222222222";

type Result = { caseId: string; status: string; detail: string };

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

async function impersonate(client: pg.Client, userId: string, role: "authenticated" | "anon"): Promise<void> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
  await client.query(
    "select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, role, aud: "authenticated" })],
  );
  await client.query(`set local role ${role}`);
}

function errCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) return String((err as { code: string }).code);
  return "UNKNOWN";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 180) : "error";
}

async function main() {
  assertTargetIdentity();
  const client = await connect();
  const results: Result[] = [];

  try {
    const schema = await client.query(`
      select
        (select count(*)::int from public.schema_migrations where filename = '066_document_lifecycle.sql') as n066,
        exists (
          select 1 from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'documents'
            and t.tgname = 'documents_protect_archive_fields' and not t.tgisinternal
        ) as trigger_ok
    `);
    if (schema.rows[0]?.n066 !== 1 || !schema.rows[0]?.trigger_ok) {
      console.error("STOP: 066 schema objects not present.");
      process.exit(2);
    }

    const docs = await client.query<{
      id: string;
      organization_id: string;
      title: string;
      archived_at: string | null;
      archived_by: string | null;
    }>(
      `select id, organization_id, title, archived_at, archived_by
       from public.documents
       where organization_id = $1
       order by created_at
       limit 1`,
      [ORG],
    );
    const doc = docs.rows[0];
    if (!doc) {
      results.push({ caseId: "DOC", status: "BLOCKED", detail: "no document in Master Touch org" });
      console.log(JSON.stringify({ existing_lifecycle: null, results }, null, 2));
      return;
    }
    console.log(
      "existing_document_lifecycle",
      JSON.stringify({ archived_at: doc.archived_at, archived_by: doc.archived_by, both_null: doc.archived_at == null && doc.archived_by == null }),
    );

    const archiveUsers = await client.query<{ id: string }>(
      `select p.id
       from public.profiles p
       where p.is_active = true
         and (
           p.is_platform_admin = true
           or exists (
             select 1
             from public.user_roles ur
             join public.roles r on r.id = ur.role_id
             join public.role_permissions rp on rp.role_id = r.id
             join public.organization_members m
               on m.profile_id = ur.profile_id
              and m.organization_id = ur.organization_id
             where ur.profile_id = p.id
               and ur.organization_id = $1
               and rp.permission_key = 'document.archive'
               and r.is_external = false
               and m.status = 'active'
           )
         )
       limit 3`,
      [ORG],
    );

    const updateNoArchive = await client.query<{ id: string }>(
      `select p.id
       from public.profiles p
       join public.user_roles ur on ur.profile_id = p.id and ur.organization_id = $1
       join public.roles r on r.id = ur.role_id
       join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = 'document.update'
       join public.organization_members m
         on m.profile_id = p.id and m.organization_id = $1 and m.status = 'active'
       where p.is_active = true
         and coalesce(p.is_platform_admin, false) = false
         and not exists (
           select 1
           from public.user_roles ur2
           join public.role_permissions rp2 on rp2.role_id = ur2.role_id
           where ur2.profile_id = p.id
             and ur2.organization_id = $1
             and rp2.permission_key = 'document.archive'
         )
       limit 3`,
      [ORG],
    );

    const archiveUser = archiveUsers.rows[0]?.id ?? null;
    const updateUser = updateNoArchive.rows[0]?.id ?? null;
    console.log("identities", {
      archive_capable: archiveUsers.rows.length,
      update_without_archive: updateNoArchive.rows.length,
    });

    const countsBefore = await client.query(`
      select
        (select count(*)::int from public.documents) as documents,
        (select count(*)::int from public.document_versions) as document_versions
    `);

    async function runCase(caseId: string, fn: () => Promise<void>): Promise<void> {
      await client.query(`savepoint sp_${caseId}`);
      try {
        await fn();
      } catch (err) {
        results.push({ caseId, status: "FAIL", detail: `${errCode(err)} ${errMsg(err)}` });
      } finally {
        await client.query(`rollback to savepoint sp_${caseId}`);
      }
    }

    await client.query("begin");

    try {
      if (!archiveUser) {
        results.push({
          caseId: "A",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no active org user with document.archive / platform admin",
        });
      } else {
        await runCase("A", async () => {
          await impersonate(client, archiveUser, "authenticated");
          await client.query(
            `update public.documents
             set archived_at = timezone('utc', now()), archived_by = $2
             where id = $1`,
            [doc.id, archiveUser],
          );
          const check = await client.query(
            `select archived_at is not null as archived from public.documents where id = $1`,
            [doc.id],
          );
          results.push({
            caseId: "A",
            status: check.rows[0]?.archived ? "PASS" : "FAIL",
            detail: "archive-capable authenticated user mutated lifecycle fields",
          });
        });
      }

      if (!updateUser) {
        results.push({
          caseId: "B",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no active org user with document.update and without document.archive",
        });
      } else {
        await runCase("B", async () => {
          await impersonate(client, updateUser, "authenticated");
          try {
            await client.query(
              `update public.documents
               set archived_at = timezone('utc', now()), archived_by = $2
               where id = $1`,
              [doc.id, updateUser],
            );
            results.push({
              caseId: "B",
              status: "FAIL",
              detail: "lifecycle mutation succeeded without document.archive",
            });
          } catch (err) {
            const code = errCode(err);
            results.push({
              caseId: "B",
              status: code === "42501" ? "PASS" : "FAIL",
              detail: `${code} ${errMsg(err)}`,
            });
          }
        });
      }

      const metadataUser = updateUser ?? archiveUser;
      if (!metadataUser) {
        results.push({
          caseId: "C",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no authenticated identity with document.update",
        });
      } else {
        await runCase("C", async () => {
          await impersonate(client, metadataUser, "authenticated");
          await client.query(`update public.documents set title = title where id = $1`, [doc.id]);
          results.push({
            caseId: "C",
            status: "PASS",
            detail: updateUser
              ? "ordinary metadata update allowed without document.archive"
              : "ordinary metadata update allowed for archive-capable user who also has document.update",
          });
        });
      }

      const crossActor = archiveUser ?? updateUser;
      if (!crossActor) {
        results.push({
          caseId: "D",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no authenticated identity to attempt organization_id change",
        });
      } else {
        await runCase("D", async () => {
          await impersonate(client, crossActor, "authenticated");
          try {
            await client.query(`update public.documents set organization_id = $2 where id = $1`, [doc.id, FAKE_ORG]);
            results.push({ caseId: "D", status: "FAIL", detail: "organization_id change succeeded" });
          } catch (err) {
            const code = errCode(err);
            results.push({
              caseId: "D",
              status: code === "42501" ? "PASS" : "FAIL",
              detail: `${code} ${errMsg(err)}`,
            });
          }
        });
      }

      await runCase("E", async () => {
        await impersonate(client, "00000000-0000-0000-0000-000000000000", "anon");
        const who = await client.query<{ usr: string; role: string | null }>(
          "select current_user as usr, auth.role() as role",
        );
        if (who.rows[0]?.usr !== "anon") {
          results.push({
            caseId: "E",
            status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
            detail: `session role is ${who.rows[0]?.usr}, not anon`,
          });
          return;
        }
        try {
          const upd = await client.query(
            `update public.documents
             set archived_at = timezone('utc', now()), archived_by = $2
             where id = $1`,
            [doc.id, doc.id],
          );
          results.push({
            caseId: "E",
            status: upd.rowCount === 0 ? "PASS" : "FAIL",
            detail: `anon current_user confirmed; auth.role=${who.rows[0]?.role}; rowCount=${upd.rowCount}`,
          });
        } catch (err) {
          results.push({
            caseId: "E",
            status: "PASS",
            detail: `${errCode(err)} ${errMsg(err)}`,
          });
        }
      });

      if (!updateUser && !archiveUser) {
        results.push({
          caseId: "F",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no authenticated identity for DELETE probe",
        });
        results.push({
          caseId: "G",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no authenticated identity for versions DELETE probe",
        });
        results.push({
          caseId: "H",
          status: "NOT CERTIFIED — SAFE TEST IDENTITY UNAVAILABLE",
          detail: "no authenticated identity for storage DELETE probe",
        });
      } else {
        const actor = updateUser ?? archiveUser!;
        await runCase("F", async () => {
          await impersonate(client, actor, "authenticated");
          try {
            const del = await client.query(`delete from public.documents where id = $1`, [doc.id]);
            results.push({
              caseId: "F",
              status: del.rowCount === 0 ? "PASS" : "FAIL",
              detail: `rowCount=${del.rowCount}`,
            });
          } catch (err) {
            results.push({ caseId: "F", status: "PASS", detail: `${errCode(err)} ${errMsg(err)}` });
          }
        });
        await runCase("G", async () => {
          await impersonate(client, actor, "authenticated");
          try {
            const del = await client.query(`delete from public.document_versions where document_id = $1`, [doc.id]);
            results.push({
              caseId: "G",
              status: del.rowCount === 0 ? "PASS" : "FAIL",
              detail: `rowCount=${del.rowCount}`,
            });
          } catch (err) {
            results.push({ caseId: "G", status: "PASS", detail: `${errCode(err)} ${errMsg(err)}` });
          }
        });
        await runCase("H", async () => {
          await impersonate(client, actor, "authenticated");
          try {
            const del = await client.query(`delete from storage.objects where bucket_id = 'documents'`);
            results.push({
              caseId: "H",
              status: del.rowCount === 0 ? "PASS" : "FAIL",
              detail: `rowCount=${del.rowCount}`,
            });
          } catch (err) {
            results.push({ caseId: "H", status: "PASS", detail: `${errCode(err)} ${errMsg(err)}` });
          }
        });
      }
    } finally {
      await client.query("rollback");
    }

    const countsAfter = await client.query(`
      select
        (select count(*)::int from public.documents) as documents,
        (select count(*)::int from public.document_versions) as document_versions,
        (select archived_at is null and archived_by is null as still_active
         from public.documents where id = $1)
    `, [doc.id]);

    const deletePolicies = await client.query(`
      select schemaname, tablename, policyname, cmd
      from pg_policies
      where (schemaname = 'public' and tablename in ('documents', 'document_versions') and cmd = 'DELETE')
         or (schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE' and policyname ilike '%document%')
    `);

    const grants = await client.query(`
      select r.code
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      where rp.permission_key = 'document.archive'
      order by r.code
    `);

    const fk = await client.query(`
      select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'documents' and c.conname like '%archived_by%'
    `);

    console.log(
      JSON.stringify(
        {
          counts_before: countsBefore.rows[0],
          counts_after_rollback: countsAfter.rows[0],
          delete_policies: deletePolicies.rows,
          document_archive_role_codes: grants.rows.map((r) => r.code),
          archived_by_fk: fk.rows.map((r) => r.def),
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
