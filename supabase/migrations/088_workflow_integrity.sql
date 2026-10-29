-- Master Touch OS — 088
-- Workflow / approval integrity: workflow state and official approval outcomes can only be
-- moved by the security definer RPCs, workflow gates can no longer be skipped through
-- C (request changes) / D (reject), and start_workflow checks org ownership.
-- Additive and idempotent. Does NOT drop any RLS policy, table or column.
--
-- Safety:
--  * "Trusted write" = the statement runs inside a security definer function (current_user
--    is the function owner, e.g. postgres) or as service_role / postgres directly.
--    Direct PostgREST writes run as current_user = 'authenticated' / 'anon' and are untrusted.
--    The guard trigger functions are SECURITY INVOKER on purpose so current_user reflects
--    the caller; this needs no flag inside the RPCs and cannot be spoofed by a client
--    (a client cannot SET ROLE to the owner, and set_config flags would be client-settable).
--  * workflow_instances / workflow_instance_steps / approval_actions: INSERT, UPDATE, DELETE
--    privileges are revoked from authenticated/anon. The app never writes them directly;
--    start_workflow, complete_workflow_step, submit_approval_decision, decide_entity_approval,
--    update_workflow_step_deadline, assign_workflow_step_responsible and
--    create_current_workflow_gate_approval are all security definer and keep working.
--  * approval_requests / approval_steps: UPDATE and DELETE are revoked from authenticated/anon
--    (decisions go through submit_approval_decision / decide_entity_approval, the English title
--    through set_approval_request_title_en — all security definer). INSERT stays allowed because
--    commercial, finance, procurement and the generic project approval create requests directly,
--    but an untrusted INSERT must start open (pending/in_progress) with no official decision,
--    be requested by the caller, and can never target entity_type 'workflow_instance_step'
--    (gate approvals only via create_current_workflow_gate_approval).
--  * apply_workflow_step_outcome (latest: 083) is re-created with three targeted changes:
--    resubmit (C) re-opens the gate itself (<=), reject (D) with a return step re-opens
--    target..gate inclusive, and a direct gate completion needs an A/B approval completed
--    during the gate's current activation (stale approvals from an earlier pass no longer count).
--  * start_workflow (latest: 076) additionally checks the definition is global or the caller's
--    organization's and that the entity belongs to the caller's organization.
--  * Existing rows are not modified.

-- =============================================================================
-- A. Trusted-write predicate (invoker: evaluates the caller's current_user)
-- =============================================================================

create or replace function public.workflow_write_is_untrusted()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- Called by the invoker guard triggers below while running as authenticated/anon.
revoke all on function public.workflow_write_is_untrusted() from public;
grant execute on function public.workflow_write_is_untrusted() to anon, authenticated, service_role;

comment on function public.workflow_write_is_untrusted() is
  '088: true when the current statement runs directly as authenticated/anon (PostgREST), false inside security definer RPCs or for service_role/postgres. Must stay SECURITY INVOKER.';

-- =============================================================================
-- B. Privileges: workflow engine tables and approval actions are RPC-only
-- =============================================================================

revoke insert, update, delete on table public.workflow_instances from anon, authenticated;
revoke insert, update, delete on table public.workflow_instance_steps from anon, authenticated;
revoke insert, update, delete on table public.approval_actions from anon, authenticated;
revoke update, delete on table public.approval_requests from anon, authenticated;
revoke update, delete on table public.approval_steps from anon, authenticated;

-- =============================================================================
-- C. Untrusted INSERT guards for approval_requests / approval_steps
-- =============================================================================

create or replace function public.guard_approval_request_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.workflow_write_is_untrusted() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'in_progress')
       or new.official_outcome is distinct from 'pending'::public.approval_decision
       or new.official_code is not null
       or new.completed_at is not null then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    if new.entity_type = 'workflow_instance_step' then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    if auth.uid() is null or new.requested_by is distinct from auth.uid() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    return new;
  end if;

  -- UPDATE privilege is revoked above; this is defence in depth if it is ever re-granted.
  if new.status is distinct from old.status
     or new.official_outcome is distinct from old.official_outcome
     or new.official_code is distinct from old.official_code
     or new.completed_at is distinct from old.completed_at
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.organization_id is distinct from old.organization_id
     or new.requested_by is distinct from old.requested_by
     or new.mode is distinct from old.mode then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_approval_request_integrity() from public, anon, authenticated;

drop trigger if exists approval_requests_00_integrity_guard on public.approval_requests;
create trigger approval_requests_00_integrity_guard
  before insert or update on public.approval_requests
  for each row execute function public.guard_approval_request_integrity();

create or replace function public.guard_approval_step_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.approval_requests;
begin
  if not public.workflow_write_is_untrusted() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'in_progress') then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    -- Evaluated under the caller's RLS: an invisible parent fails closed.
    select * into v_request
    from public.approval_requests
    where id = new.request_id;

    if v_request.id is null
       or v_request.organization_id is distinct from new.organization_id
       or v_request.status not in ('pending', 'in_progress')
       or v_request.entity_type = 'workflow_instance_step'
       or auth.uid() is null
       or v_request.requested_by is distinct from auth.uid() then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    return new;
  end if;

  -- UPDATE privilege is revoked above; defence in depth.
  if new.status is distinct from old.status
     or new.request_id is distinct from old.request_id
     or new.organization_id is distinct from old.organization_id
     or new.sequence is distinct from old.sequence
     or new.approver_type is distinct from old.approver_type
     or new.user_id is distinct from old.user_id
     or new.role_id is distinct from old.role_id
     or new.department_id is distinct from old.department_id
     or new.delegated_to is distinct from old.delegated_to then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_approval_step_integrity() from public, anon, authenticated;

drop trigger if exists approval_steps_00_integrity_guard on public.approval_steps;
create trigger approval_steps_00_integrity_guard
  before insert or update on public.approval_steps
  for each row execute function public.guard_approval_step_integrity();

-- =============================================================================
-- D. apply_workflow_step_outcome — 083 body, gate re-open on C/D + fresh gate approval
-- =============================================================================

create or replace function public.apply_workflow_step_outcome(
  p_instance_step_id uuid,
  p_outcome text,
  p_source text
)
returns public.workflow_instance_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workflow_instance_steps;
  v_def public.workflow_steps;
  v_instance public.workflow_instances;
  v_next public.workflow_instance_steps;
  v_target public.workflow_instance_steps;
  v_gate_ok boolean := false;
begin
  if p_outcome not in ('complete', 'reject', 'resubmit') then
    raise exception 'VALIDATION';
  end if;

  if p_source not in ('direct', 'approval_gate') then
    raise exception 'VALIDATION';
  end if;

  select * into v_step
  from public.workflow_instance_steps
  where id = p_instance_step_id
  for update;

  if v_step.id is null then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_def from public.workflow_steps where id = v_step.step_id;

  if p_source = 'direct' then
    if not (
      (
        (
          public.has_permission('workflow.advance', v_step.organization_id)
          or public.has_permission('workflow.manage', v_step.organization_id)
        )
        and (
          public.has_permission('workflow.manage', v_step.organization_id)
          or public.can_act_on_workflow_step(p_instance_step_id)
        )
      )
      or public.can_execute_workflow_instance_step(p_instance_step_id)
    ) then
      raise exception 'FORBIDDEN';
    end if;

    if coalesce(v_def.requires_approval, false) then
      -- 088: the A/B approval must belong to the gate's current activation; an approval
      -- from an earlier pass (before a C/D or a downstream return re-opened the gate)
      -- no longer satisfies the gate.
      select exists (
        select 1
        from public.approval_requests r
        where r.organization_id = v_step.organization_id
          and r.entity_type = 'workflow_instance_step'
          and r.entity_id = v_step.id
          and r.status = 'completed'
          and r.official_code in ('A', 'B')
          and coalesce(r.completed_at, r.updated_at) >= coalesce(v_step.started_at, '-infinity'::timestamptz)
      ) into v_gate_ok;

      if not v_gate_ok then
        raise exception 'WORKFLOW_GATE_REQUIRED';
      end if;
    end if;
  end if;

  if v_step.status not in ('ready', 'in_progress') then
    raise exception 'CONFLICT';
  end if;

  select * into v_instance
  from public.workflow_instances
  where id = v_step.instance_id
  for update;

  if v_instance.status in ('completed', 'cancelled') then
    raise exception 'CONFLICT';
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'procurement' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_procurement_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_PROCUREMENT_NOT_READY';
    end if;
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'mobilization' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_mobilization_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_MOBILIZATION_NOT_READY';
    end if;
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'execution' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_execution_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_EXECUTION_NOT_READY';
    end if;
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'testing_commissioning' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_commissioning_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_COMMISSIONING_NOT_READY';
    end if;
  end if;

  if p_source = 'direct'
     and p_outcome = 'complete'
     and v_step.step_key = 'handover' then
    if v_instance.entity_type is distinct from 'project'
       or not public.project_has_handover_completion_package(v_instance.entity_id) then
      raise exception 'WORKFLOW_HANDOVER_NOT_READY';
    end if;
  end if;

  if p_outcome = 'reject' then
    update public.workflow_instance_steps
    set status = 'rejected', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
    returning * into v_step;

    if v_def.on_reject_step_key is null then
      update public.workflow_instance_steps
      set status = 'cancelled'
      where instance_id = v_instance.id
        and id <> v_step.id
        and status in ('pending', 'ready', 'in_progress');

      update public.workflow_instances
      set status = 'cancelled', completed_at = timezone('utc', now())
      where id = v_instance.id;
    else
      select * into v_target
      from public.workflow_instance_steps
      where instance_id = v_instance.id and step_key = v_def.on_reject_step_key
      for update;

      if v_target.id is null then
        raise exception 'VALIDATION';
      end if;

      update public.workflow_instance_steps
      set status = 'ready', started_at = timezone('utc', now()),
          completed_at = null, completed_by = null
      where id = v_target.id;

      -- 088: re-open every step after the return target up to AND including this gate,
      -- so the rejected gate must be passed again instead of being skipped.
      if v_target.sequence < v_step.sequence then
        update public.workflow_instance_steps s
        set status = 'pending'::public.workflow_step_status,
            started_at = null,
            completed_at = null,
            completed_by = null
        where s.instance_id = v_instance.id
          and s.sequence > v_target.sequence
          and s.sequence <= v_step.sequence;
      end if;

      select * into v_step from public.workflow_instance_steps where id = v_step.id;
    end if;
  elsif p_outcome = 'resubmit' then
    if v_def.on_resubmit_step_key is null then
      raise exception 'VALIDATION';
    end if;

    update public.workflow_instance_steps
    set status = 'completed', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
    returning * into v_step;

    -- 088: <= so the gate itself is re-opened (it was excluded by < before and stayed completed).
    update public.workflow_instance_steps s
    set status = case when s.step_key = v_def.on_resubmit_step_key then 'ready'::public.workflow_step_status else 'pending'::public.workflow_step_status end,
        started_at = case when s.step_key = v_def.on_resubmit_step_key then timezone('utc', now()) else null end,
        completed_at = null,
        completed_by = null
    where s.instance_id = v_instance.id
      and s.sequence >= (
        select sequence from public.workflow_instance_steps
        where instance_id = v_instance.id and step_key = v_def.on_resubmit_step_key
      )
      and s.sequence <= v_step.sequence;

    select * into v_step from public.workflow_instance_steps where id = v_step.id;
  else
    update public.workflow_instance_steps
    set status = 'completed', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
      and status in ('ready', 'in_progress')
    returning * into v_step;

    if v_step.id is null then
      raise exception 'CONFLICT';
    end if;

    select * into v_next
    from public.workflow_instance_steps
    where instance_id = v_instance.id
      and status = 'pending'
    order by sequence
    limit 1;

    if v_next.id is null then
      update public.workflow_instances
      set status = 'completed', completed_at = timezone('utc', now())
      where id = v_instance.id;
    else
      update public.workflow_instance_steps
      set status = 'ready', started_at = timezone('utc', now())
      where id = v_next.id;
    end if;
  end if;

  perform public.log_audit(
    v_step.organization_id,
    'workflow.step.completed',
    'workflow_instance_step',
    v_step.id,
    null,
    jsonb_build_object(
      'outcome', p_outcome,
      'source', p_source,
      'automatic', (p_source = 'approval_gate')
    )
  );
  perform public.emit_domain_event(
    v_step.organization_id,
    'workflow.step.completed',
    'workflow_instance_step',
    v_step.id,
    jsonb_build_object(
      'outcome', p_outcome,
      'source', p_source,
      'automatic', (p_source = 'approval_gate')
    )
  );

  return v_step;
end;
$$;

revoke all on function public.apply_workflow_step_outcome(uuid, text, text)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- E. start_workflow — 076 body + definition / entity organization ownership
-- =============================================================================

create or replace function public.start_workflow(
  p_organization_id uuid,
  p_definition_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns public.workflow_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.workflow_versions;
  v_instance public.workflow_instances;
  v_step record;
  v_first boolean := true;
  v_def_entity text;
  v_def_org uuid;
  v_responsible uuid;
  v_entity_ok boolean := true;
begin
  if not public.has_permission('workflow.start', p_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  select entity_type, organization_id into v_def_entity, v_def_org
  from public.workflow_definitions
  where id = p_definition_id;

  if v_def_entity is null then
    raise exception 'NOT_FOUND';
  end if;

  -- 088: only global templates or the caller's own organization's templates.
  if v_def_org is not null and v_def_org is distinct from p_organization_id then
    raise exception 'NOT_FOUND';
  end if;

  if v_def_entity is distinct from p_entity_type then
    raise exception 'VALIDATION';
  end if;

  -- 088: the entity must belong to the caller's organization (known entity tables).
  if p_entity_type = 'project' then
    select exists (select 1 from public.projects where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  elsif p_entity_type = 'document' then
    select exists (select 1 from public.documents where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  elsif p_entity_type = 'rfi' then
    select exists (select 1 from public.rfis where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  elsif p_entity_type = 'material_submittal' then
    select exists (select 1 from public.material_submittals where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  elsif p_entity_type = 'shop_drawing' then
    select exists (select 1 from public.shop_drawings where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  elsif p_entity_type = 'method_statement' then
    select exists (select 1 from public.method_statements where id = p_entity_id and organization_id = p_organization_id)
    into v_entity_ok;
  end if;

  if not coalesce(v_entity_ok, false) then
    raise exception 'VALIDATION';
  end if;

  if exists (
    select 1
    from public.workflow_instances i
    where i.organization_id = p_organization_id
      and i.definition_id = p_definition_id
      and i.entity_type = p_entity_type
      and i.entity_id = p_entity_id
      and i.status in ('pending', 'in_progress')
  ) then
    raise exception 'CONFLICT';
  end if;

  select *
  into v_version
  from public.workflow_versions
  where definition_id = p_definition_id
    and status = 'published'
  order by version_number desc
  limit 1;

  if v_version.id is null then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.workflow_instances (
    organization_id, definition_id, version_id, entity_type, entity_id, status, started_by
  ) values (
    p_organization_id, p_definition_id, v_version.id, p_entity_type, p_entity_id, 'in_progress', auth.uid()
  ) returning * into v_instance;

  for v_step in
    select *
    from public.workflow_steps
    where version_id = v_version.id
    order by sequence
  loop
    v_responsible := null;
    if p_entity_type = 'project' then
      select a.responsible_user_id
      into v_responsible
      from public.project_workflow_step_assignments a
      where a.organization_id = p_organization_id
        and a.project_id = p_entity_id
        and a.workflow_step_id = v_step.id;
    end if;

    insert into public.workflow_instance_steps (
      organization_id, instance_id, step_id, step_key, sequence, status,
      assigned_user_id, assigned_role_id, assigned_department_id, responsible_user_id,
      due_at, warning_at
    ) values (
      p_organization_id,
      v_instance.id,
      v_step.id,
      v_step.key,
      v_step.sequence,
      case when v_first then 'ready'::public.workflow_step_status else 'pending'::public.workflow_step_status end,
      v_step.assigned_user_id,
      v_step.assigned_role_id,
      v_step.assigned_department_id,
      v_responsible,
      case when v_first and v_step.sla_hours is not null
        then timezone('utc', now()) + make_interval(hours => v_step.sla_hours)
      end,
      case when v_first and v_step.warning_hours is not null
        then timezone('utc', now()) + make_interval(hours => v_step.warning_hours)
      end
    );
    v_first := false;
  end loop;

  perform public.log_audit(p_organization_id, 'workflow.started', 'workflow_instance', v_instance.id, null, to_jsonb(v_instance));
  perform public.emit_domain_event(p_organization_id, 'workflow.started', 'workflow_instance', v_instance.id, '{}'::jsonb);
  return v_instance;
end;
$$;

revoke all on function public.start_workflow(uuid, uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.start_workflow(uuid, uuid, text, uuid) to authenticated;
