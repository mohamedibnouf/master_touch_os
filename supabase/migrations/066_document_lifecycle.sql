-- Master Touch OS — 066
-- Document lifecycle: non-destructive archive + restore.
-- Additive. Does NOT modify migrations 001–065.
-- Does NOT use documents.status = 'archived' (that enum remains register/workflow state).
-- Does NOT add DELETE policies on documents or document_versions.
-- Does NOT delete Storage objects or Google Drive files.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists archived_at timestamptz;

-- ON DELETE RESTRICT: profile removal must not cascade-delete documents or null the pair.
alter table public.documents
  add column if not exists archived_by uuid references public.profiles (id) on delete restrict;

alter table public.documents
  drop constraint if exists documents_archive_pair_chk;

alter table public.documents
  add constraint documents_archive_pair_chk
  check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null)
  );

create index if not exists documents_org_archived_idx
  on public.documents (organization_id, archived_at)
  where archived_at is not null;

comment on column public.documents.archived_at is
  'Product archive (حذف المستند). Null means active. Independent of document_status.';

-- ---------------------------------------------------------------------------
-- Permission
-- ---------------------------------------------------------------------------
insert into public.permissions (key, resource, action, description_ar, description_en)
values (
  'document.archive',
  'document',
  'archive',
  'أرشفة واستعادة المستندات من النظام دون حذف الملفات',
  'Archive and restore documents in Master Touch without deleting files'
)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'document.archive'
from public.roles r
where r.code in ('super_admin', 'general_manager', 'operations_manager', 'document_controller')
on conflict do nothing;

-- Trusted DB sessions: service_role JWT, or table-owner postgres/supabase_admin
-- without an authenticated/anon JWT. Absence of auth.uid() alone is NOT trusted.
create or replace function public.document_lifecycle_trusted_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or (
      current_user in ('postgres', 'supabase_admin')
      and coalesce(auth.role(), '') not in ('authenticated', 'anon')
    );
$$;

revoke all on function public.document_lifecycle_trusted_session() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Column-level protection (document.update cannot change archive fields)
-- ---------------------------------------------------------------------------
create or replace function public.protect_document_archive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.archived_at is null and new.archived_by is null then
      return new;
    end if;
    if public.document_lifecycle_trusted_session() then
      return new;
    end if;
    if auth.uid() is null or not public.has_permission('document.archive', new.organization_id) then
      raise exception 'FORBIDDEN'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  if new.archived_at is not distinct from old.archived_at
     and new.archived_by is not distinct from old.archived_by then
    return new;
  end if;

  if public.document_lifecycle_trusted_session() then
    return new;
  end if;

  if auth.uid() is null or not public.has_permission('document.archive', new.organization_id) then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_protect_archive_fields on public.documents;

create trigger documents_protect_archive_fields
  before insert or update on public.documents
  for each row
  execute function public.protect_document_archive_fields();

revoke all on function public.protect_document_archive_fields() from public, anon, authenticated;
