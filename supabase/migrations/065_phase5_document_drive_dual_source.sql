-- Master Touch OS — 065
-- Dual-source document files: Supabase Storage (legacy) OR Google Drive reference.
-- Additive. Does NOT modify migrations 001–064.
-- Does NOT connect Google APIs. Stores a validated Drive file reference only.
-- Existing Storage rows remain file_source = storage via column default.
-- Controlled-register RPCs (029) still insert Storage placeholder versions.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.document_versions
  add column if not exists file_source text not null default 'storage';

alter table public.document_versions
  add column if not exists external_provider text;

alter table public.document_versions
  add column if not exists external_file_id text;

alter table public.document_versions
  add column if not exists external_url text;

-- Drive Simple mode may not know MIME/size. Storage rows keep values via check below.
alter table public.document_versions
  alter column file_path drop not null;

alter table public.document_versions
  alter column mime_type drop not null;

alter table public.document_versions
  alter column size_bytes drop not null;

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
alter table public.document_versions
  drop constraint if exists document_versions_file_source_check;

alter table public.document_versions
  add constraint document_versions_file_source_check
  check (file_source in ('storage', 'google_drive'));

alter table public.document_versions
  drop constraint if exists document_versions_external_provider_check;

alter table public.document_versions
  add constraint document_versions_external_provider_check
  check (external_provider is null or external_provider = 'google_drive');

alter table public.document_versions
  drop constraint if exists document_versions_file_source_integrity;

alter table public.document_versions
  add constraint document_versions_file_source_integrity
  check (
    (
      file_source = 'storage'
      and file_path is not null
      and length(btrim(file_path)) > 0
      and mime_type is not null
      and size_bytes is not null
      and external_provider is null
      and external_file_id is null
      and external_url is null
    )
    or
    (
      file_source = 'google_drive'
      and file_path is null
      and external_provider = 'google_drive'
      and external_file_id is not null
      and length(btrim(external_file_id)) > 0
      and external_url is not null
      and length(btrim(external_url)) > 0
      and external_url ~ '^https://(drive|docs)\.google\.com/'
    )
  );

create index if not exists document_versions_file_source_idx
  on public.document_versions (organization_id, file_source);

comment on column public.document_versions.file_source is
  'Authoritative file host: storage (Supabase documents bucket) or google_drive (external reference).';

comment on column public.document_versions.external_url is
  'Canonical https Google Drive/Docs view URL. Not documents.external_reference.';

-- ---------------------------------------------------------------------------
-- RLS: project members may read versions of documents on projects they can access.
-- Does NOT grant document.read. Does NOT expose other-org or other-project docs.
-- Storage object policies (012) are unchanged — signed URLs still need document.read.
-- ---------------------------------------------------------------------------
drop policy if exists document_versions_select on public.document_versions;

create policy document_versions_select on public.document_versions
  for select to authenticated
  using (
    public.has_permission('document.read', organization_id)
    or exists (
      select 1
      from public.documents d
      where d.id = document_versions.document_id
        and d.organization_id = document_versions.organization_id
        and d.project_id is not null
        and public.can_access_project(d.project_id)
    )
  );
