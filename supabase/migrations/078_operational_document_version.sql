-- Master Touch OS — 078
-- Operational document letter revisions (A→B→C) via a narrow SECURITY DEFINER writer.
-- Does NOT edit 077, 029, or document_versions RLS.
-- Does NOT add a document_versions UPDATE policy.
-- Does NOT complete workflow, create approvals, or use register R00/R01 numbering.

create or replace function public.next_operational_revision_code(p_current text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_letter text;
begin
  v_letter := upper(btrim(coalesce(p_current, '')));
  if v_letter !~ '^[A-Y]$' then
    raise exception 'VALIDATION';
  end if;
  return chr(ascii(v_letter) + 1);
end;
$$;

revoke all on function public.next_operational_revision_code(text)
  from public, anon, authenticated, service_role;

create or replace function public.create_operational_document_version(
  p_document_id uuid,
  p_expected_current_revision text,
  p_file_source text,
  p_file_name text,
  p_file_path text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_checksum text default null,
  p_external_provider text default null,
  p_external_file_id text default null,
  p_external_url text default null,
  p_change_description text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
  v_current public.document_versions;
  v_next text;
  v_prefix text;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_doc
  from public.documents
  where id = p_document_id
  for update;

  if v_doc.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.is_organization_member(v_doc.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.has_permission('document.upload', v_doc.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_doc.is_register_controlled then
    raise exception 'REGISTER_CONTROLLED';
  end if;

  if v_doc.archived_at is not null then
    raise exception 'ARCHIVED';
  end if;

  select * into v_current
  from public.document_versions
  where document_id = v_doc.id
    and is_current = true
  for update;

  if v_current.id is null then
    raise exception 'VALIDATION';
  end if;

  if v_current.revision is distinct from v_doc.current_revision then
    raise exception 'VALIDATION';
  end if;

  if upper(btrim(coalesce(p_expected_current_revision, ''))) is distinct from v_doc.current_revision then
    raise exception 'STALE_REVISION';
  end if;

  v_next := public.next_operational_revision_code(v_doc.current_revision);

  if exists (
    select 1 from public.document_versions
    where document_id = v_doc.id and revision = v_next
  ) then
    raise exception 'STALE_REVISION';
  end if;

  if p_file_source = 'storage' then
    if p_file_path is null or length(btrim(p_file_path)) = 0 then
      raise exception 'VALIDATION';
    end if;
    if p_file_path is not distinct from v_current.file_path then
      raise exception 'VALIDATION';
    end if;
    v_prefix := v_doc.organization_id::text
      || '/' || coalesce(v_doc.project_id::text, 'org')
      || '/' || v_doc.id::text
      || '/' || v_next
      || '/';
    if left(p_file_path, length(v_prefix)) <> v_prefix then
      raise exception 'VALIDATION';
    end if;
    if p_mime_type is null or length(btrim(p_mime_type)) = 0 or p_size_bytes is null then
      raise exception 'VALIDATION';
    end if;
    if p_external_provider is not null or p_external_file_id is not null or p_external_url is not null then
      raise exception 'VALIDATION';
    end if;
  elsif p_file_source = 'google_drive' then
    if p_file_path is not null then
      raise exception 'VALIDATION';
    end if;
    if coalesce(p_external_provider, '') is distinct from 'google_drive' then
      raise exception 'VALIDATION';
    end if;
    if p_external_file_id is null or length(btrim(p_external_file_id)) = 0 then
      raise exception 'VALIDATION';
    end if;
    if p_external_url is null
       or p_external_url !~ '^https://(drive|docs)\.google\.com/' then
      raise exception 'VALIDATION';
    end if;
  else
    raise exception 'VALIDATION';
  end if;

  if p_file_name is null or length(btrim(p_file_name)) = 0 then
    raise exception 'VALIDATION';
  end if;

  update public.document_versions
  set is_current = false,
      is_superseded = true,
      superseded_at = v_now
  where document_id = v_doc.id
    and is_current = true
    and id = v_current.id;

  if not found then
    raise exception 'STALE_REVISION';
  end if;

  insert into public.document_versions (
    organization_id,
    document_id,
    revision,
    file_source,
    file_path,
    file_name,
    mime_type,
    size_bytes,
    checksum,
    uploaded_by,
    uploaded_at,
    is_current,
    is_superseded,
    change_description,
    external_provider,
    external_file_id,
    external_url
  ) values (
    v_doc.organization_id,
    v_doc.id,
    v_next,
    p_file_source,
    case when p_file_source = 'storage' then p_file_path else null end,
    p_file_name,
    p_mime_type,
    p_size_bytes,
    p_checksum,
    auth.uid(),
    v_now,
    true,
    false,
    p_change_description,
    case when p_file_source = 'google_drive' then 'google_drive' else null end,
    case when p_file_source = 'google_drive' then p_external_file_id else null end,
    case when p_file_source = 'google_drive' then p_external_url else null end
  );

  update public.documents
  set current_revision = v_next,
      status = 'submitted',
      updated_at = v_now
  where id = v_doc.id
  returning * into v_doc;

  perform public.log_audit(
    v_doc.organization_id,
    'document.revised',
    'document',
    v_doc.id,
    jsonb_build_object(
      'revision', v_current.revision,
      'version_id', v_current.id
    ),
    jsonb_build_object(
      'revision', v_next,
      'file_source', p_file_source
    )
  );

  perform public.emit_domain_event(
    v_doc.organization_id,
    'document.revised',
    'document',
    v_doc.id,
    jsonb_build_object('revision', v_next, 'previous_revision', v_current.revision)
  );

  return v_doc;
exception
  when unique_violation then
    raise exception 'STALE_REVISION';
end;
$$;

revoke all on function public.create_operational_document_version(
  uuid, text, text, text, text, text, bigint, text, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_operational_document_version(
  uuid, text, text, text, text, text, bigint, text, text, text, text, text
) to authenticated;

comment on function public.create_operational_document_version(
  uuid, text, text, text, text, text, bigint, text, text, text, text, text
) is
  'Registers an operational letter revision (A→B). Does not complete workflow or approve documents.';
