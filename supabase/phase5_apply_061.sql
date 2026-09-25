-- Master Touch OS — 061
-- Phase 5.5: Document Intelligence (Business Case extraction + verification)
-- Justification: documents/document_versions have no jsonb/extraction/verification columns;
-- audit_logs are not a product store for verified, revision-bound intelligence.
--
-- Security: composite FKs bind org+document+version. Verification is RPC-only
-- (document.approve). Authenticated DELETE is denied. Verified rows are immutable.

-- Binding indexes on existing parents (id is already unique; composites enable FKs)
create unique index documents_id_org_uidx
  on public.documents (id, organization_id);

create unique index document_versions_id_doc_org_uidx
  on public.document_versions (id, document_id, organization_id);

create type public.document_intelligence_type as enum (
  'BUSINESS_CASE',
  'PROJECT_BRIEF',
  'GENERAL_PROJECT_DOCUMENT'
);

create type public.document_intelligence_status as enum (
  'PENDING',
  'PROCESSING',
  'EXTRACTED',
  'VERIFIED',
  'FAILED',
  'SUPERSEDED'
);

create table public.document_intelligence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  document_version_id uuid not null,
  intelligence_type public.document_intelligence_type not null default 'BUSINESS_CASE',
  schema_version text not null default 'business-case-v1',
  status public.document_intelligence_status not null default 'PENDING',
  provider text not null default 'none',
  model text,
  extraction_payload jsonb not null default '{}'::jsonb,
  extraction_warnings jsonb not null default '[]'::jsonb,
  character_count integer not null default 0,
  chunk_count integer not null default 0,
  error_message text,
  source_checksum text,
  created_by uuid not null references public.profiles (id),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint document_intelligence_document_org_fk
    foreign key (document_id, organization_id)
    references public.documents (id, organization_id)
    on delete cascade,
  constraint document_intelligence_version_doc_org_fk
    foreign key (document_version_id, document_id, organization_id)
    references public.document_versions (id, document_id, organization_id)
    on delete cascade,
  constraint document_intelligence_character_count_chk check (character_count >= 0),
  constraint document_intelligence_chunk_count_chk check (chunk_count >= 0),
  constraint document_intelligence_payload_object_chk
    check (jsonb_typeof(extraction_payload) = 'object'),
  constraint document_intelligence_warnings_array_chk
    check (jsonb_typeof(extraction_warnings) = 'array'),
  constraint document_intelligence_verified_fields_chk check (
    (
      status = 'VERIFIED'
      and verified_by is not null
      and verified_at is not null
    )
    or (
      status <> 'VERIFIED'
      and verified_by is null
      and verified_at is null
    )
  )
);

create trigger document_intelligence_set_updated_at
  before update on public.document_intelligence
  for each row execute function public.set_updated_at();

-- One non-terminal extraction per document version + type + schema.
-- FAILED is omitted so a retry INSERT is allowed. VERIFIED remains unique
-- so a second active extraction cannot replace verified intelligence.
create unique index document_intelligence_active_uidx
  on public.document_intelligence (document_version_id, intelligence_type, schema_version)
  where status in ('PENDING', 'PROCESSING', 'EXTRACTED', 'VERIFIED');

create index document_intelligence_doc_idx
  on public.document_intelligence (organization_id, document_id, created_at desc);

create index document_intelligence_version_idx
  on public.document_intelligence (document_version_id);

-- Access: project-linked documents require can_access_project (not org-wide document.read).
-- Org-only documents (project_id is null) require document.read on that organization.
create or replace function public.can_access_document_for_intelligence(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and public.is_organization_member(d.organization_id)
      and (
        (
          d.project_id is not null
          and public.can_access_project(d.project_id)
        )
        or (
          d.project_id is null
          and public.has_permission(
            'document.read',
            d.organization_id,
            'organization',
            null
          )
        )
      )
  );
$$;

create or replace function public.can_analyze_document_intelligence(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and public.can_access_document_for_intelligence(d.id)
      and (
        public.has_permission('document.upload', d.organization_id, 'organization', null)
        or public.has_permission('document.update', d.organization_id, 'organization', null)
      )
  );
$$;

create or replace function public.document_intelligence_enforce()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    if new.status not in ('PENDING', 'PROCESSING') then
      raise exception 'VALIDATION';
    end if;
    new.verified_by := null;
    new.verified_at := null;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.document_id is distinct from old.document_id
     or new.document_version_id is distinct from old.document_version_id
     or new.intelligence_type is distinct from old.intelligence_type
     or new.schema_version is distinct from old.schema_version
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'VALIDATION';
  end if;

  if old.status in ('VERIFIED', 'FAILED', 'SUPERSEDED') then
    raise exception 'VALIDATION';
  end if;

  if old.status = 'PENDING' and new.status not in ('PROCESSING', 'FAILED') then
    raise exception 'VALIDATION';
  end if;

  if old.status = 'PROCESSING' and new.status not in ('EXTRACTED', 'FAILED') then
    raise exception 'VALIDATION';
  end if;

  if old.status = 'EXTRACTED' then
    if new.status <> 'VERIFIED' then
      raise exception 'VALIDATION';
    end if;
    if new.extraction_payload is distinct from old.extraction_payload
       or new.extraction_warnings is distinct from old.extraction_warnings
       or new.character_count is distinct from old.character_count
       or new.chunk_count is distinct from old.chunk_count
       or new.source_checksum is distinct from old.source_checksum
       or new.provider is distinct from old.provider
       or new.model is distinct from old.model then
      raise exception 'VALIDATION';
    end if;
    if auth.uid() is null then
      raise exception 'FORBIDDEN';
    end if;
    new.verified_by := auth.uid();
    new.verified_at := timezone('utc', now());
    return new;
  end if;

  new.verified_by := null;
  new.verified_at := null;
  return new;
end;
$$;

create trigger document_intelligence_enforce
  before insert or update on public.document_intelligence
  for each row execute function public.document_intelligence_enforce();

create or replace function public.verify_document_intelligence(p_intelligence_id uuid)
returns public.document_intelligence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.document_intelligence;
  v_doc public.documents;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not public.is_active_profile() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row
  from public.document_intelligence
  where id = p_intelligence_id
  for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_doc
  from public.documents
  where id = v_row.document_id;

  if v_doc.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_doc.organization_id is distinct from v_row.organization_id then
    raise exception 'FORBIDDEN';
  end if;

  if not public.has_permission(
    'document.approve',
    v_row.organization_id,
    'organization',
    null
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_document_for_intelligence(v_row.document_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_row.status <> 'EXTRACTED' then
    raise exception 'VALIDATION';
  end if;

  update public.document_intelligence
  set status = 'VERIFIED'
  where id = v_row.id
    and status = 'EXTRACTED'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'VALIDATION';
  end if;

  perform public.log_audit(
    v_row.organization_id,
    'document_intelligence.verified',
    'document_intelligence',
    v_row.id,
    null,
    jsonb_build_object('status', 'VERIFIED', 'document_id', v_row.document_id)
  );

  return v_row;
end;
$$;

revoke all on function public.can_access_document_for_intelligence(uuid) from public, anon;
revoke all on function public.can_analyze_document_intelligence(uuid) from public, anon;
revoke all on function public.verify_document_intelligence(uuid) from public, anon;
grant execute on function public.can_access_document_for_intelligence(uuid) to authenticated;
grant execute on function public.can_analyze_document_intelligence(uuid) to authenticated;
grant execute on function public.verify_document_intelligence(uuid) to authenticated;

alter table public.document_intelligence enable row level security;

create policy document_intelligence_select on public.document_intelligence
  for select to authenticated
  using (public.can_access_document_for_intelligence(document_id));

create policy document_intelligence_insert on public.document_intelligence
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and verified_by is null
    and verified_at is null
    and status in ('PENDING', 'PROCESSING')
    and public.can_analyze_document_intelligence(document_id)
  );

-- Extraction pipeline only. EXTRACTED → VERIFIED is RPC (bypasses this policy).
create policy document_intelligence_update on public.document_intelligence
  for update to authenticated
  using (
    status in ('PENDING', 'PROCESSING')
    and public.can_analyze_document_intelligence(document_id)
  )
  with check (
    status in ('PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED')
    and public.can_analyze_document_intelligence(document_id)
  );

-- No DELETE policy: authenticated users cannot delete. Parent cascade removes rows.

comment on table public.document_intelligence is
  'Phase 5.5 revision-bound AI document extraction. EXTRACTED=proposed; VERIFIED=human-confirmed via verify_document_intelligence. Never auto-mutates projects.';
