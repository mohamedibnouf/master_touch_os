#!/usr/bin/env node
/**
 * Identity-gated hotfix: job_titles_same_org RAISE MESSAGE conflict.
 * Historical one-shot: production 068 applied once, then this replaced only
 * the trigger function. Does not insert schema_migrations. Does not rerun 068.
 * Local 068 SQL already contains the corrected function. Not an npm hook.
 */
import { connect, identityOk, FILE_068 } from "./phase5-db-gate";

const SQL = `
create or replace function public.job_titles_same_org()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dept_org uuid;
begin
  if new.department_id is not null then
    select d.organization_id into v_dept_org
    from public.departments d
    where d.id = new.department_id;
    if v_dept_org is null or v_dept_org is distinct from new.organization_id then
      raise exception 'JOB_TITLE_DEPARTMENT_ORG_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  if new.created_by is not null
     and not exists (
       select 1
       from public.organization_members m
       where m.profile_id = new.created_by
         and m.organization_id = new.organization_id
         and m.status = 'active'
     )
  then
    raise exception 'JOB_TITLE_CREATED_BY_ORG_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
`;

async function main() {
  const client = await connect();
  try {
    if (!(await identityOk(client))) {
      console.error("STOP: target identity not proven.");
      process.exit(2);
    }
    const n = await client.query<{ n: number }>(
      "select count(*)::int as n from public.schema_migrations where filename = $1",
      [FILE_068],
    );
    if (n.rows[0]?.n !== 1) {
      console.error("STOP: 068 must exist exactly once before hotfix.");
      process.exit(2);
    }
    await client.query("begin");
    try {
      await client.query(SQL);
      await client.query("commit");
      console.log("ok job_titles_same_org raise hotfix");
    } catch (err) {
      await client.query("rollback");
      console.error("FAIL hotfix", err instanceof Error ? err.message : "error");
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
