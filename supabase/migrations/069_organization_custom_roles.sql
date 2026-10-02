-- Master Touch OS — 069
-- Organization custom roles & permissions (additive).
-- Reuses public.roles / role_permissions / user_roles.
-- Does NOT modify 067 employee eight or 068 job titles.
-- Does NOT apply department-scoped RLS.
-- Does NOT hard-delete roles (deactivate only).
--
-- Future controlled system-role catalog migrations MUST run as postgres/supabase_admin:
--   select set_config('master_touch.allow_system_role_ddl', 'on', true);
-- Authenticated sessions cannot enable the bypass (GUC alone is ignored).

-- =============================================================================
-- A. Columns (organizational metadata + lifecycle)
-- =============================================================================

alter table public.roles
  add column if not exists is_active boolean not null default true;

alter table public.roles
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.roles
  add column if not exists department_id uuid references public.departments (id) on delete set null;

comment on column public.roles.department_id is
  'Optional organizational grouping for custom roles. Metadata only — not data-scope security.';
comment on column public.roles.is_active is
  'Custom-role lifecycle. Inactive custom roles do not grant authorization. System roles stay active.';
comment on column public.roles.created_by is
  'Profile that created a custom role. Null for seeded system roles.';

create index if not exists roles_org_custom_active_idx
  on public.roles (organization_id, is_active)
  where is_system = false and organization_id is not null;

create or replace function public.roles_custom_org_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dept_org uuid;
  v_dept_active boolean;
begin
  if new.department_id is not null then
    if new.organization_id is null then
      raise exception 'ROLE_DEPARTMENT_ORG_MISMATCH' using errcode = 'P0001';
    end if;
    select d.organization_id, d.is_active into v_dept_org, v_dept_active
    from public.departments d
    where d.id = new.department_id;
    if v_dept_org is null or v_dept_org is distinct from new.organization_id then
      raise exception 'ROLE_DEPARTMENT_ORG_MISMATCH' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' and v_dept_active is not true then
      raise exception 'ROLE_DEPARTMENT_INACTIVE' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE'
       and new.department_id is distinct from old.department_id
       and v_dept_active is not true then
      raise exception 'ROLE_DEPARTMENT_INACTIVE' using errcode = 'P0001';
    end if;
  end if;
  if new.created_by is not null
     and new.organization_id is not null
     and not exists (
       select 1
       from public.organization_members m
       where m.profile_id = new.created_by
         and m.organization_id = new.organization_id
         and m.status = 'active'
     )
  then
    raise exception 'ROLE_CREATED_BY_ORG_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists roles_custom_org_guard on public.roles;
create trigger roles_custom_org_guard
  before insert or update on public.roles
  for each row execute function public.roles_custom_org_guard();

-- =============================================================================
-- B. role.manage catalog + grants (before immutability triggers)
-- =============================================================================

insert into public.permissions (key, resource, action, description_ar, description_en)
values
  ('role.manage', 'role', 'manage', 'إدارة الأدوار المخصصة وصلاحياتها', 'Manage organization custom roles')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'role.manage'
from public.roles r
where r.organization_id is null
  and r.is_system = true
  and r.code in ('super_admin', 'general_manager')
on conflict do nothing;

-- Forward-only viewer drift fix (do not edit 013).
-- 013 granted viewer every permissions.key LIKE '%.read', which included role.read.
-- Catalog VIEWER_PERMISSIONS does not include role.read. Remove only that grant.
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.organization_id is null
  and r.is_system = true
  and r.code = 'viewer'
  and rp.permission_key = 'role.read';

-- =============================================================================
-- C. Effective permissions + has_permission (inactive custom roles do not grant)
-- =============================================================================

create or replace function public.current_effective_permission_keys(p_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_platform_admin() then coalesce((select array_agg(p.key order by p.key) from public.permissions p), '{}'::text[])
    else coalesce((
      select array_agg(distinct rp.permission_key)
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.role_permissions rp on rp.role_id = r.id
      join public.profiles p on p.id = ur.profile_id
      join public.organization_members m
        on m.profile_id = ur.profile_id
       and m.organization_id = ur.organization_id
      where ur.profile_id = auth.uid()
        and ur.organization_id = p_organization_id
        and r.is_external = false
        and (r.is_system = true or r.is_active = true)
        and p.is_active = true
        and m.status = 'active'
        and ur.scope_type = 'organization'
    ), '{}'::text[])
  end;
$$;

create or replace function public.has_permission(
  p_permission_key text,
  p_organization_id uuid,
  p_scope_type public.role_scope_type default 'organization',
  p_scope_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.role_permissions rp on rp.role_id = r.id
      join public.profiles p on p.id = ur.profile_id
      join public.organization_members m
        on m.profile_id = ur.profile_id
       and m.organization_id = ur.organization_id
      where ur.profile_id = auth.uid()
        and ur.organization_id = p_organization_id
        and rp.permission_key = p_permission_key
        and r.is_external = false
        and (r.is_system = true or r.is_active = true)
        and p.is_active = true
        and m.status = 'active'
        and (
          ur.scope_type = 'organization'
          or (
            p_scope_type = ur.scope_type
            and p_scope_id is not null
            and ur.scope_id = p_scope_id
          )
        )
    );
$$;

-- Non-delegable keys: cannot be copied into organization custom roles.
-- Official system roles may continue to hold them.
create or replace function public.non_delegable_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'settings.manage',
    'role.manage',
    'role.assign',
    'user.create',
    'user.disable',
    'user.update',
    'organization.update'
  ]::text[];
$$;

create or replace function public.normalize_custom_role_code(p_code text, p_name_en text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_raw text;
  v_code text;
begin
  v_raw := coalesce(nullif(btrim(p_code), ''), p_name_en);
  v_code := lower(regexp_replace(coalesce(v_raw, ''), '[^a-zA-Z0-9]+', '_', 'g'));
  v_code := trim(both '_' from v_code);
  if v_code is null or v_code = '' then
    return null;
  end if;
  if char_length(v_code) > 64 then
    v_code := left(v_code, 64);
  end if;
  return v_code;
end;
$$;

create or replace function public.assert_custom_role_permission_set(
  p_organization_id uuid,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held text[];
  v_key text;
  v_denied text[];
begin
  if p_permission_keys is null or cardinality(p_permission_keys) < 1 then
    raise exception 'ROLE_PERMISSIONS_REQUIRED' using errcode = 'P0001';
  end if;

  v_held := public.current_effective_permission_keys(p_organization_id);
  v_denied := public.non_delegable_permission_keys();

  foreach v_key in array p_permission_keys
  loop
    if v_key is null or btrim(v_key) = '' then
      raise exception 'ROLE_PERMISSION_UNKNOWN' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.permissions p where p.key = v_key) then
      raise exception 'ROLE_PERMISSION_UNKNOWN' using errcode = 'P0001';
    end if;
    if v_key = any (v_denied) then
      raise exception 'ROLE_PERMISSION_NON_DELEGABLE' using errcode = 'P0001';
    end if;
    if not (v_key = any (v_held)) then
      raise exception 'ROLE_PERMISSION_NOT_HELD' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

create or replace function public.assert_can_manage_custom_roles(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.is_active_profile() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.is_organization_member(p_organization_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not public.has_permission('role.manage', p_organization_id, 'organization', null) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.replace_custom_role_permissions(p_role_id uuid, p_permission_keys text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, x.key
  from (select distinct btrim(k) as key from unnest(p_permission_keys) as k) x
  where x.key <> '';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_organization_role(
  p_organization_id uuid,
  p_name_ar text,
  p_name_en text,
  p_code text,
  p_department_id uuid,
  p_permission_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
  v_perm_count integer;
begin
  perform public.assert_can_manage_custom_roles(p_organization_id);
  if coalesce(btrim(p_name_ar), '') = '' or coalesce(btrim(p_name_en), '') = '' then
    raise exception 'ROLE_NAMES_REQUIRED' using errcode = 'P0001';
  end if;
  perform public.assert_custom_role_permission_set(p_organization_id, p_permission_keys);

  v_code := public.normalize_custom_role_code(p_code, p_name_en);
  if v_code is null then
    v_code := 'custom_' || substr(md5(p_name_ar || chr(1) || p_name_en || chr(1) || p_organization_id::text), 1, 12);
  end if;
  if exists (
    select 1 from public.roles r
    where r.organization_id is null and lower(r.code) = v_code
  ) then
    raise exception 'ROLE_CODE_RESERVED' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.roles r
    where r.organization_id = p_organization_id and lower(r.code) = v_code
  ) then
    raise exception 'ROLE_CODE_DUPLICATE' using errcode = 'P0001';
  end if;

  insert into public.roles (
    organization_id, code, name_ar, name_en, is_system, is_external, is_active, created_by, department_id
  ) values (
    p_organization_id,
    v_code,
    btrim(p_name_ar),
    btrim(p_name_en),
    false,
    false,
    true,
    auth.uid(),
    p_department_id
  )
  returning id into v_id;

  v_perm_count := public.replace_custom_role_permissions(v_id, p_permission_keys);

  perform public.log_audit(
    p_organization_id,
    'role.created',
    'role',
    v_id,
    null,
    jsonb_build_object('code', v_code, 'permission_count', v_perm_count)
  );
  return v_id;
end;
$$;

create or replace function public.update_organization_role(
  p_organization_id uuid,
  p_role_id uuid,
  p_name_ar text,
  p_name_en text,
  p_department_id uuid,
  p_permission_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles;
  v_perm_count integer;
begin
  perform public.assert_can_manage_custom_roles(p_organization_id);
  if coalesce(btrim(p_name_ar), '') = '' or coalesce(btrim(p_name_en), '') = '' then
    raise exception 'ROLE_NAMES_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_role.is_system or v_role.organization_id is null then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if v_role.organization_id is distinct from p_organization_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  perform public.assert_custom_role_permission_set(p_organization_id, p_permission_keys);

  update public.roles
  set name_ar = btrim(p_name_ar),
      name_en = btrim(p_name_en),
      department_id = p_department_id
  where id = p_role_id
    and organization_id = p_organization_id
    and is_system = false;

  v_perm_count := public.replace_custom_role_permissions(p_role_id, p_permission_keys);

  perform public.log_audit(
    p_organization_id,
    'role.updated',
    'role',
    p_role_id,
    jsonb_build_object('name_ar', v_role.name_ar),
    jsonb_build_object('name_ar', btrim(p_name_ar), 'permission_count', v_perm_count)
  );
  return p_role_id;
end;
$$;

create or replace function public.set_organization_role_active(
  p_organization_id uuid,
  p_role_id uuid,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles;
  v_keys text[];
begin
  perform public.assert_can_manage_custom_roles(p_organization_id);

  select * into v_role from public.roles where id = p_role_id;
  if v_role.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_role.is_system or v_role.organization_id is null then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if v_role.organization_id is distinct from p_organization_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_is_active then
    select coalesce(array_agg(rp.permission_key), '{}'::text[])
      into v_keys
    from public.role_permissions rp
    where rp.role_id = p_role_id;
    perform public.assert_custom_role_permission_set(p_organization_id, v_keys);
  end if;

  update public.roles
  set is_active = p_is_active
  where id = p_role_id
    and organization_id = p_organization_id
    and is_system = false;

  perform public.log_audit(
    p_organization_id,
    case when p_is_active then 'role.reactivated' else 'role.deactivated' end,
    'role',
    p_role_id,
    jsonb_build_object('is_active', v_role.is_active),
    jsonb_build_object('is_active', p_is_active)
  );
  return p_role_id;
end;
$$;

grant execute on function public.current_effective_permission_keys(uuid) to authenticated;
grant execute on function public.non_delegable_permission_keys() to authenticated;
grant execute on function public.normalize_custom_role_code(text, text) to authenticated;
grant execute on function public.create_organization_role(uuid, text, text, text, uuid, text[]) to authenticated;
grant execute on function public.update_organization_role(uuid, uuid, text, text, uuid, text[]) to authenticated;
grant execute on function public.set_organization_role_active(uuid, uuid, boolean) to authenticated;

-- Internal helpers: not granted to authenticated (security definer callees).
revoke all on function public.assert_custom_role_permission_set(uuid, text[]) from public, authenticated;
revoke all on function public.assert_can_manage_custom_roles(uuid) from public, authenticated;
revoke all on function public.replace_custom_role_permissions(uuid, text[]) from public, authenticated;

-- =============================================================================
-- D. System-role immutability (after catalog grants)
-- Bypass for future migrations (postgres/supabase_admin session only):
--   select set_config('master_touch.allow_system_role_ddl', 'on', true);
-- =============================================================================

create or replace function public.system_role_ddl_allowed()
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  -- Authenticated/anon cannot enable bypass via set_config; GUC is ignored unless
  -- the executing role is a migration/admin database user.
  if current_user <> 'postgres'
     and current_user <> 'supabase_admin'
     and current_user not like 'postgres.%' then
    return false;
  end if;
  return coalesce(nullif(current_setting('master_touch.allow_system_role_ddl', true), ''), 'off') = 'on';
end;
$$;

revoke all on function public.system_role_ddl_allowed() from public, authenticated, anon;

create or replace function public.roles_protect_system()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if (old.is_system = true or old.organization_id is null)
       and not public.system_role_ddl_allowed() then
      raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if (new.is_system = true or new.organization_id is null)
       and not public.system_role_ddl_allowed() then
      raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
    end if;
    if new.is_system = true and new.organization_id is not null then
      raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    raise exception 'ROLE_ORG_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.is_system = false and new.code is distinct from old.code then
    raise exception 'ROLE_CODE_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.is_system = false and new.is_system is distinct from false then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
  end if;

  if (old.is_system = true or old.organization_id is null)
     and not public.system_role_ddl_allowed() then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists roles_protect_system on public.roles;
create trigger roles_protect_system
  before insert or update or delete on public.roles
  for each row execute function public.roles_protect_system();

create or replace function public.role_permissions_protect_system()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_system boolean;
  v_org uuid;
  v_role_id uuid;
begin
  v_role_id := case when tg_op = 'DELETE' then old.role_id else new.role_id end;
  select r.is_system, r.organization_id into v_system, v_org
  from public.roles r
  where r.id = v_role_id;
  if (v_system = true or v_org is null)
     and not public.system_role_ddl_allowed() then
    raise exception 'SYSTEM_ROLE_PERMISSIONS_IMMUTABLE' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists role_permissions_protect_system on public.role_permissions;
create trigger role_permissions_protect_system
  before insert or update or delete on public.role_permissions
  for each row execute function public.role_permissions_protect_system();

comment on function public.create_organization_role(uuid, text, text, text, uuid, text[]) is
  'Creates an organization custom role. Enforces role.manage, catalog keys, actor subset, and non-delegable denylist.';
comment on function public.has_permission(text, uuid, public.role_scope_type, uuid) is
  '069: inactive custom roles (is_system = false and is_active = false) do not grant permissions.';
