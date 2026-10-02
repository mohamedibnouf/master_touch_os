-- Master Touch OS — 068
-- Organization-scoped job title catalog.
-- Additive. Does NOT modify 067 or employee role grants.
-- Does NOT backfill employees.job_title_id.
-- Does NOT delete job titles (deactivate only).
--
-- Production: applied exactly once (schema_migrations 068 = 1). NEVER re-run there.
-- After apply, job_titles_same_org was hotfixed to remove RAISE ... USING message =
-- (PostgreSQL: RAISE option already specified: MESSAGE).
-- This file is the canonical corrected SQL for fresh environments.
-- Production function body was replaced via scripts/hotfix-phase5-068-trigger-raise.ts only.

create table public.job_titles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid references public.departments (id) on delete restrict,
  code text,
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger job_titles_set_updated_at
  before update on public.job_titles
  for each row execute function public.set_updated_at();

create index job_titles_org_active_idx
  on public.job_titles (organization_id, is_active, sort_order, name_ar);

create index job_titles_department_idx
  on public.job_titles (department_id)
  where department_id is not null;

create unique index job_titles_org_wide_name_ar_uidx
  on public.job_titles (organization_id, lower(btrim(name_ar)))
  where department_id is null;

create unique index job_titles_dept_name_ar_uidx
  on public.job_titles (organization_id, department_id, lower(btrim(name_ar)))
  where department_id is not null;

create unique index job_titles_org_code_uidx
  on public.job_titles (organization_id, lower(btrim(code)))
  where code is not null and btrim(code) <> '';

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

drop trigger if exists job_titles_same_org on public.job_titles;
create trigger job_titles_same_org
  before insert or update on public.job_titles
  for each row execute function public.job_titles_same_org();

alter table public.employees
  add column if not exists job_title_id uuid references public.job_titles (id) on delete restrict;

create index if not exists employees_job_title_id_idx
  on public.employees (job_title_id)
  where job_title_id is not null;

insert into public.permissions (key, resource, action, description_ar, description_en)
values
  ('job_title.read', 'job_title', 'read', 'عرض المسميات الوظيفية', 'Read job titles'),
  ('job_title.manage', 'job_title', 'manage', 'إدارة المسميات الوظيفية', 'Manage job titles')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.organization_id is null
  and r.code = 'super_admin'
  and p.key in ('job_title.read', 'job_title.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.organization_id is null
  and r.code = 'general_manager'
  and p.key in ('job_title.read', 'job_title.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.organization_id is null
  and r.code = 'hr_manager'
  and p.key in ('job_title.read', 'job_title.manage')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.organization_id is null
  and r.code = 'hr_officer'
  and p.key = 'job_title.read'
on conflict do nothing;

alter table public.job_titles enable row level security;

drop policy if exists job_titles_select on public.job_titles;
create policy job_titles_select on public.job_titles
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists job_titles_insert on public.job_titles;
create policy job_titles_insert on public.job_titles
  for insert to authenticated
  with check (
    public.has_permission('job_title.manage', organization_id, 'organization', null)
    and public.is_organization_member(organization_id)
  );

drop policy if exists job_titles_update on public.job_titles;
create policy job_titles_update on public.job_titles
  for update to authenticated
  using (
    public.has_permission('job_title.manage', organization_id, 'organization', null)
  )
  with check (
    public.has_permission('job_title.manage', organization_id, 'organization', null)
    and public.is_organization_member(organization_id)
  );

comment on table public.job_titles is
  'Organization job-title catalog. Occupation only — not RBAC. Deactivate instead of delete.';
comment on column public.employees.job_title_id is
  'Optional catalog FK. job_title_ar/en remain display snapshots. NULL is a valid legacy row.';
comment on function public.job_titles_same_org() is
  'Rejects cross-org department_id and created_by that is not an active member of the title organization.';
