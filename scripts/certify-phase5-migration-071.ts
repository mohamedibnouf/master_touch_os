#!/usr/bin/env node
/** Read-only + rollback-safe 071 certification. Never persists mailbox. Never logs secrets. */
import { connect, identityOk, ORG, EIGHT, FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071 } from "./phase5-db-gate";

const FILES = [FILE_066, FILE_067, FILE_068, FILE_069, FILE_070, FILE_071];
const PRIMARY = "mohamedibnouf.en@gmail.com";
const OFFICIAL = "info@mastertouch-ksa.com";
const CUSTOM_ROLE = "9e3ae9a4-832e-4aa6-a308-4f6b468dee68";

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) process.exit(2);

    const mig = await client.query<{ filename: string; n: number }>(
      "select filename, count(*)::int as n from public.schema_migrations where filename = any($1::text[]) group by filename order by 1",
      [FILES],
    );
    console.log("migration_counts", mig.rows);

    const col = await client.query(
      `select c.data_type, c.is_nullable, c.column_default
       from information_schema.columns c
       where c.table_schema='public' and c.table_name='organizations' and c.column_name='management_notification_email'`,
    );
    console.log("column_def", col.rows[0]);

    const orgVal = await client.query<{ n: number; is_null: boolean }>(
      `select count(*)::int as n, bool_and(management_notification_email is null) as is_null
       from public.organizations where id = $1`,
      [ORG],
    );
    console.log("target_org_null", orgVal.rows[0]);

    const chk = await client.query<{ conname: string; consrc: string }>(
      `select con.conname,
              pg_get_constraintdef(con.oid) as consrc
       from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname='public' and rel.relname='organizations'
         and con.conname='organizations_management_notification_email_chk'`,
    );
    console.log("check_def", chk.rows[0]);

    const trg = await client.query(
      `select t.tgname, t.tgenabled, p.proname,
              pg_get_triggerdef(t.oid) as tgdef
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc p on p.oid = t.tgfoid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='organizations'
         and t.tgname='protect_management_notification_email' and not t.tgisinternal`,
    );
    console.log("trigger", {
      name: trg.rows[0]?.tgname,
      enabled: trg.rows[0]?.tgenabled,
      fn: trg.rows[0]?.proname,
      def: trg.rows[0]?.tgdef,
    });

    const fn = await client.query<{ owner: string; def: string }>(
      `select r.rolname as owner, pg_get_functiondef(p.oid) as def
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_roles r on r.oid = p.proowner
       where n.nspname='public' and p.proname='protect_management_notification_email'`,
    );
    console.log("function_owner", fn.rows[0]?.owner);
    console.log("function_has_settings_manage", fn.rows[0]?.def?.includes("settings.manage"));
    console.log("function_has_trusted", fn.rows[0]?.def?.includes("document_lifecycle_trusted_session"));
    console.log("function_has_lower_btrim", fn.rows[0]?.def?.includes("lower(btrim"));

    const acl = await client.query<{ proname: string; public_exec: boolean; anon_exec: boolean; auth_exec: boolean }>(
      `select p.proname,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='protect_management_notification_email'`,
    );
    console.log("function_acl", acl.rows[0]);

    const rls = await client.query<{ polname: string; cmd: string; roles: string[] }>(
      `select pol.polname, pol.polcmd as cmd, pol.polroles::regrole[] as roles
       from pg_policy pol
       join pg_class c on c.oid = pol.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relname='organizations'
       order by pol.polname`,
    );
    console.log("org_policies", rls.rows);

    const trusted = await client.query<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='document_lifecycle_trusted_session'`,
    );
    const tdef = trusted.rows[0]?.def ?? "";
    console.log("trusted_session_service_role", tdef.includes("service_role"));
    console.log("trusted_session_blocks_authenticated_jwt", tdef.includes("authenticated") && tdef.includes("anon"));
    console.log("trusted_no_guc", !/current_setting|set_config/i.test(tdef));

    // A valid value in a rolled-back txn (postgres owner = trusted)
    await client.query("begin");
    try {
      await client.query(`update public.organizations set management_notification_email = 'Ops@Notify.Example.COM' where id = $1`, [ORG]);
      const after = await client.query<{ v: string | null }>(
        `select management_notification_email as v from public.organizations where id = $1`,
        [ORG],
      );
      console.log("rollback_valid_normalized", after.rows[0]?.v);
      await client.query("rollback");
    } catch (e) {
      await client.query("rollback");
      console.log("rollback_valid_FAIL", e instanceof Error ? e.message.slice(0, 120) : "error");
    }

    await client.query("begin");
    try {
      await client.query(`update public.organizations set management_notification_email = 'not-an-email' where id = $1`, [ORG]);
      console.log("rollback_invalid", "UNEXPECTED_ACCEPT");
      await client.query("rollback");
    } catch {
      await client.query("rollback");
      console.log("rollback_invalid", "DENIED");
    }

    await client.query("begin");
    try {
      await client.query(`update public.organizations set management_notification_email = '   ' where id = $1`, [ORG]);
      const after = await client.query<{ v: string | null }>(
        `select management_notification_email as v from public.organizations where id = $1`,
        [ORG],
      );
      console.log("rollback_whitespace_stored", after.rows[0]?.v);
      await client.query("rollback");
    } catch (e) {
      await client.query("rollback");
      console.log("rollback_whitespace_FAIL", e instanceof Error ? e.message.slice(0, 120) : "error");
    }

    const stillNull = await client.query<{ v: string | null }>(
      `select management_notification_email as v from public.organizations where id = $1`,
      [ORG],
    );
    console.log("persisted_value_after_rollbacks", stillNull.rows[0]?.v);

    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query(`update public.organizations set management_notification_email = 'ops@notify.example.com' where id = $1`, [ORG]);
      console.log("unauthorized_authenticated", "UNEXPECTED_ACCEPT");
      await client.query("rollback");
    } catch (e) {
      await client.query("rollback");
      const msg = e instanceof Error ? e.message : String(e);
      console.log("unauthorized_authenticated", /FORBIDDEN|42501|permission denied/i.test(msg) ? "DENY" : msg.slice(0, 160));
    }

    const hp = await client.query<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='has_permission' order by p.oid limit 1`,
    );
    console.log("has_permission_org_bind", hp.rows[0]?.def?.includes("ur.organization_id = p_organization_id"));
    console.log("unauthorized_jwt", "NOT LIVE-JWT-CERTIFIED");

    const audits = await client.query<{ n: number }>(
      `select count(*)::int as n from public.audit_logs where action = 'organization.management_notification_email.changed'`,
    );
    console.log("mailbox_audit_events", audits.rows[0]);

    const eight = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where r.code = 'employee' and r.organization_id is null`,
    );
    const viewer = await client.query<{ n: number }>(
      `select count(*)::int as n from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where r.code = 'viewer' and rp.permission_key = 'role.read'`,
    );
    console.log("employee_eight", eight.rows[0], "expected", EIGHT.length);
    console.log("viewer_role_read", viewer.rows[0]);

    const admins = await client.query(
      `select case when u.email = $2 then 'official' else 'primary' end as who,
              array_agg(r.code order by r.code) as codes
       from auth.users u
       join public.user_roles ur on ur.profile_id = u.id and ur.organization_id = $1
       join public.roles r on r.id = ur.role_id
       where u.email in ($2,$3)
       group by 1`,
      [ORG, OFFICIAL, PRIMARY],
    );
    console.log("admins", admins.rows);

    const custom = await client.query(
      `select id::text, is_active, is_system, (select count(*)::int from public.user_roles ur where ur.role_id = r.id) as assignments
       from public.roles r where id = $1`,
      [CUSTOM_ROLE],
    );
    console.log("custom_role_residue", custom.rows[0]);

    const docs = await client.query(
      `select count(*)::int as documents,
              count(*) filter (where archived_at is null)::int as active,
              count(*) filter (where archived_at is not null)::int as archived
       from public.documents where organization_id = $1`,
      [ORG],
    );
    console.log("documents", docs.rows[0]);
    const titles = await client.query(
      `select count(*)::int as n from public.job_titles where organization_id = $1`,
      [ORG],
    );
    console.log("job_titles", titles.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
