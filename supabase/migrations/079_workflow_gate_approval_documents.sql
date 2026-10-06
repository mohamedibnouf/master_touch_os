-- Master Touch OS — 079
-- Current workflow-gate approval create + frozen supporting document versions.
-- Additive. Does NOT replace 073 submit_approval_decision / apply_workflow_step_outcome.
-- Does NOT edit 077 step-local execution or 078 operational document version.
-- Does NOT enable the 072 messaging channel. Does NOT call AI providers.

create unique index if not exists approval_requests_id_org_uidx
  on public.approval_requests (id, organization_id);

-- One open gate approval per workflow instance-step (race-safe).
create unique index if not exists approval_requests_open_workflow_step_uidx
  on public.approval_requests (organization_id, entity_type, entity_id)
  where entity_type = 'workflow_instance_step'
    and status in ('pending', 'in_progress');

create table public.approval_request_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  approval_request_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  revision text not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null references public.profiles (id) on delete restrict,
  constraint approval_request_documents_request_org_fk
    foreign key (approval_request_id, organization_id)
    references public.approval_requests (id, organization_id)
    on delete cascade,
  constraint approval_request_documents_document_org_fk
    foreign key (document_id, organization_id)
    references public.documents (id, organization_id)
    on delete restrict,
  constraint approval_request_documents_version_doc_org_fk
    foreign key (document_version_id, document_id, organization_id)
    references public.document_versions (id, document_id, organization_id)
    on delete restrict,
  unique (approval_request_id, document_id),
  unique (approval_request_id, document_version_id)
);

create index approval_request_documents_request_idx
  on public.approval_request_documents (approval_request_id, created_at);

create index approval_request_documents_document_idx
  on public.approval_request_documents (document_id);

comment on table public.approval_request_documents is
  'Frozen supporting artifacts for an approval. document_version_id is the reviewed revision; later current_revision must not rewrite this row.';

alter table public.approval_request_documents enable row level security;

revoke all on table public.approval_request_documents from public, anon, authenticated;
grant select on table public.approval_request_documents to authenticated;

create policy approval_request_documents_select on public.approval_request_documents
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and exists (
      select 1
      from public.approval_requests r
      where r.id = approval_request_id
        and r.organization_id = organization_id
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_id
        and d.organization_id = organization_id
        and (
          (d.project_id is not null and public.can_access_project(d.project_id))
          or (
            d.project_id is null
            and public.has_permission('document.read', organization_id)
          )
        )
    )
  );

create or replace function public.create_current_workflow_gate_approval(
  p_project_id uuid,
  p_approver_profile_id uuid,
  p_title text,
  p_document_version_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_instance public.workflow_instances;
  v_step public.workflow_instance_steps;
  v_requires boolean;
  v_step_name text;
  v_title text;
  v_due timestamptz;
  v_request_id uuid;
  v_version_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_doc public.documents;
  v_ver public.document_versions;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id
  for share;

  if v_project.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_permission('approval.create', v_project.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_project(v_project.id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_approver_profile_id is null then
    raise exception 'VALIDATION';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = v_project.organization_id
      and m.profile_id = p_approver_profile_id
      and m.status = 'active'
      and p.is_active = true
  ) then
    raise exception 'VALIDATION';
  end if;

  if exists (
    select 1
    from public.employees e
    where e.organization_id = v_project.organization_id
      and e.profile_id = p_approver_profile_id
  ) and not exists (
    select 1
    from public.employees e
    where e.organization_id = v_project.organization_id
      and e.profile_id = p_approver_profile_id
      and e.is_active = true
  ) then
    raise exception 'VALIDATION';
  end if;

  select i.*
  into v_instance
  from public.workflow_instances i
  where i.organization_id = v_project.organization_id
    and i.entity_type = 'project'
    and i.entity_id = v_project.id
    and i.status = 'in_progress'
  order by i.started_at desc
  limit 1
  for update;

  if v_instance.id is null then
    raise exception 'NO_ACTIVE_WORKFLOW';
  end if;

  select s.*
  into v_step
  from public.workflow_instance_steps s
  where s.instance_id = v_instance.id
    and s.organization_id = v_project.organization_id
    and s.status in ('ready', 'in_progress')
  order by s.sequence
  limit 1
  for update;

  if v_step.id is null then
    raise exception 'NO_ACTIONABLE_GATE';
  end if;

  select coalesce(ws.requires_approval, false), ws.name_ar
  into v_requires, v_step_name
  from public.workflow_steps ws
  where ws.id = v_step.step_id;

  if not coalesce(v_requires, false) then
    raise exception 'GATE_NOT_REQUIRED';
  end if;

  if p_document_version_ids is null or coalesce(cardinality(p_document_version_ids), 0) = 0 then
    raise exception 'DOCUMENT_REQUIRED';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := 'اعتماد مرحلة ' || coalesce(v_step_name, v_step.step_key);
  end if;
  if char_length(v_title) < 2 or char_length(v_title) > 240 then
    raise exception 'VALIDATION';
  end if;

  v_due := timezone('utc', now()) + interval '48 hours';

  insert into public.approval_requests (
    organization_id, entity_type, entity_id, title, status, mode,
    requested_by, due_at, warning_at
  ) values (
    v_project.organization_id,
    'workflow_instance_step',
    v_step.id,
    v_title,
    'in_progress',
    'sequential',
    auth.uid(),
    v_due,
    v_due - interval '24 hours'
  )
  returning id into v_request_id;

  insert into public.approval_steps (
    organization_id, request_id, sequence, approver_type, user_id, status, due_at
  ) values (
    v_project.organization_id,
    v_request_id,
    1,
    'user',
    p_approver_profile_id,
    'in_progress',
    v_due
  );

  foreach v_version_id in array p_document_version_ids
  loop
    if v_version_id = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_version_id);

    select * into v_ver
    from public.document_versions
    where id = v_version_id
      and organization_id = v_project.organization_id;

    if v_ver.id is null then
      raise exception 'DOCUMENT_INVALID';
    end if;

    select * into v_doc
    from public.documents
    where id = v_ver.document_id
      and organization_id = v_project.organization_id;

    if v_doc.id is null then
      raise exception 'DOCUMENT_INVALID';
    end if;

    if v_doc.archived_at is not null or v_doc.status = 'archived' then
      raise exception 'DOCUMENT_ARCHIVED';
    end if;

    if v_doc.project_id is distinct from v_project.id then
      raise exception 'DOCUMENT_PROJECT_MISMATCH';
    end if;

    if v_ver.document_id is distinct from v_doc.id then
      raise exception 'DOCUMENT_INVALID';
    end if;

    insert into public.approval_request_documents (
      organization_id, approval_request_id, document_id, document_version_id, revision, created_by
    ) values (
      v_project.organization_id,
      v_request_id,
      v_doc.id,
      v_ver.id,
      v_ver.revision,
      auth.uid()
    );

    perform public.log_audit(
      v_project.organization_id,
      'approval.document.linked',
      'approval_request',
      v_request_id,
      null,
      jsonb_build_object(
        'document_id', v_doc.id,
        'document_version_id', v_ver.id,
        'revision', v_ver.revision
      )
    );
  end loop;

  if coalesce(cardinality(v_seen), 0) = 0 then
    raise exception 'DOCUMENT_REQUIRED';
  end if;

  perform public.log_audit(
    v_project.organization_id,
    'workflow.approval.requested',
    'approval_request',
    v_request_id,
    null,
    jsonb_build_object(
      'project_id', v_project.id,
      'workflow_instance_id', v_instance.id,
      'workflow_instance_step_id', v_step.id,
      'step_key', v_step.step_key,
      'approver_profile_id', p_approver_profile_id,
      'document_version_ids', to_jsonb(v_seen)
    )
  );
  perform public.emit_domain_event(
    v_project.organization_id,
    'workflow.approval.requested',
    'approval_request',
    v_request_id,
    jsonb_build_object(
      'project_id', v_project.id,
      'workflow_instance_step_id', v_step.id,
      'step_key', v_step.step_key
    )
  );

  return v_request_id;
exception
  when unique_violation then
    raise exception 'DUPLICATE_OPEN_GATE';
end;
$$;

revoke all on function public.create_current_workflow_gate_approval(uuid, uuid, text, uuid[])
  from public, anon, service_role;
grant execute on function public.create_current_workflow_gate_approval(uuid, uuid, text, uuid[])
  to authenticated;

comment on function public.create_current_workflow_gate_approval(uuid, uuid, text, uuid[]) is
  'Creates a 073-compatible workflow-gate approval for the current actionable requires_approval step. Derives instance-step from the project. Browser step ids are ignored.';
