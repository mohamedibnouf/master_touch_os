-- Master Touch OS — 073
-- Atomic approval-gate → workflow transition + project lifecycle definition.
-- Additive. Does NOT modify 001–072 bodies in place except CREATE OR REPLACE of
-- existing SECURITY DEFINER RPCs (same signatures).
-- Does NOT mutate existing projects or start workflow instances.
-- Does NOT enable WhatsApp.

-- =============================================================================
-- Internal transition (not granted to authenticated). Called by:
--   complete_workflow_step (source = direct)
--   submit_approval_decision (source = approval_gate)
-- Actor for audit/completed_by remains auth.uid().
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
      public.has_permission('workflow.advance', v_step.organization_id)
      or public.has_permission('workflow.manage', v_step.organization_id)
    ) then
      raise exception 'FORBIDDEN';
    end if;

    if not (
      public.has_permission('workflow.manage', v_step.organization_id)
      or public.can_act_on_workflow_step(p_instance_step_id)
    ) then
      raise exception 'FORBIDDEN';
    end if;

    if coalesce(v_def.requires_approval, false) then
      select exists (
        select 1
        from public.approval_requests r
        where r.organization_id = v_step.organization_id
          and r.entity_type = 'workflow_instance_step'
          and r.entity_id = v_step.id
          and r.status = 'completed'
          and r.official_code in ('A', 'B')
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
      set status = 'ready', started_at = timezone('utc', now())
      where id = v_target.id;
    end if;
  elsif p_outcome = 'resubmit' then
    if v_def.on_resubmit_step_key is null then
      raise exception 'VALIDATION';
    end if;

    update public.workflow_instance_steps
    set status = 'completed', completed_at = timezone('utc', now()), completed_by = auth.uid()
    where id = v_step.id
    returning * into v_step;

    update public.workflow_instance_steps s
    set status = case when s.step_key = v_def.on_resubmit_step_key then 'ready'::public.workflow_step_status else 'pending'::public.workflow_step_status end,
        completed_at = null,
        completed_by = null
    where s.instance_id = v_instance.id
      and s.sequence >= (
        select sequence from public.workflow_instance_steps
        where instance_id = v_instance.id and step_key = v_def.on_resubmit_step_key
      )
      and s.sequence < v_step.sequence;
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

create or replace function public.complete_workflow_step(
  p_instance_step_id uuid,
  p_outcome text
)
returns public.workflow_instance_steps
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_workflow_step_outcome(p_instance_step_id, p_outcome, 'direct');
end;
$$;

revoke all on function public.complete_workflow_step(uuid, text)
  from public, anon, service_role;
grant execute on function public.complete_workflow_step(uuid, text) to authenticated;

-- =============================================================================
-- submit_approval_decision: same approval state machine, then atomic gate.
-- =============================================================================

create or replace function public.submit_approval_decision(
  p_step_id uuid,
  p_official_code text,
  p_comment text default null
)
returns public.approval_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.approval_steps;
  v_request public.approval_requests;
  v_decision public.approval_decision;
  v_action public.approval_actions;
  v_next public.approval_steps;
  v_wf public.workflow_instance_steps;
  v_instance public.workflow_instances;
  v_outcome text;
begin
  if p_official_code not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'VALIDATION';
  end if;

  v_decision := case p_official_code
    when 'A' then 'approved'::public.approval_decision
    when 'B' then 'approved_as_noted'::public.approval_decision
    when 'C' then 'resubmit'::public.approval_decision
    when 'D' then 'rejected'::public.approval_decision
    else 'for_information'::public.approval_decision
  end;

  select * into v_step
  from public.approval_steps
  where id = p_step_id
  for update;

  if v_step.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_decision in ('rejected') and not public.has_permission('approval.reject', v_step.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_decision not in ('rejected') and not (
    public.has_permission('approval.approve', v_step.organization_id)
    or public.has_permission('approval.review', v_step.organization_id)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_act_on_approval_step(p_step_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_step.status in ('completed', 'cancelled', 'skipped') then
    raise exception 'CONFLICT';
  end if;

  if exists (select 1 from public.approval_actions where step_id = v_step.id) then
    raise exception 'CONFLICT';
  end if;

  select * into v_request
  from public.approval_requests
  where id = v_step.request_id
  for update;

  if v_request.status in ('completed', 'cancelled') then
    raise exception 'CONFLICT';
  end if;

  if v_request.mode = 'sequential' then
    if exists (
      select 1
      from public.approval_steps s
      where s.request_id = v_request.id
        and s.sequence < v_step.sequence
        and s.status in ('pending', 'in_progress')
    ) then
      raise exception 'CONFLICT';
    end if;
  end if;

  if v_request.entity_type = 'workflow_instance_step' then
    select * into v_wf
    from public.workflow_instance_steps
    where id = v_request.entity_id
    for update;

    if v_wf.id is null then
      raise exception 'WORKFLOW_LINK_INVALID';
    end if;

    if v_wf.organization_id is distinct from v_request.organization_id then
      raise exception 'WORKFLOW_LINK_INVALID';
    end if;

    select * into v_instance
    from public.workflow_instances
    where id = v_wf.instance_id
    for update;

    if v_instance.id is null or v_instance.organization_id is distinct from v_request.organization_id then
      raise exception 'WORKFLOW_LINK_INVALID';
    end if;

    if v_instance.status in ('completed', 'cancelled') then
      raise exception 'WORKFLOW_LINK_INVALID';
    end if;

    -- A–D may only move the linked instance-step row, never a sibling/other-project step.
    if p_official_code in ('A', 'B', 'C', 'D') and v_wf.status not in ('ready', 'in_progress') then
      raise exception 'WORKFLOW_LINK_INVALID';
    end if;
  end if;

  insert into public.approval_actions (
    organization_id, request_id, step_id, actor_id, decision, official_code, comment
  ) values (
    v_step.organization_id, v_request.id, v_step.id, auth.uid(), v_decision, p_official_code, p_comment
  ) returning * into v_action;

  update public.approval_steps
  set status = 'completed'
  where id = v_step.id;

  if v_decision in ('rejected', 'resubmit') or not exists (
    select 1 from public.approval_steps
    where request_id = v_request.id
      and id <> v_step.id
      and status in ('pending', 'in_progress')
  ) then
    update public.approval_requests
    set status = 'completed',
        official_outcome = v_decision,
        official_code = p_official_code,
        completed_at = timezone('utc', now())
    where id = v_request.id;
  else
    select * into v_next
    from public.approval_steps
    where request_id = v_request.id
      and status = 'pending'
    order by sequence
    limit 1;

    if v_next.id is not null and v_request.mode = 'sequential' then
      update public.approval_steps set status = 'in_progress' where id = v_next.id;
    end if;

    update public.approval_requests
    set status = 'in_progress'
    where id = v_request.id;
  end if;

  perform public.log_audit(
    v_step.organization_id,
    case
      when v_decision = 'rejected' then 'approval.rejected'
      when v_decision = 'resubmit' then 'approval.resubmitted'
      else 'approval.approved'
    end,
    'approval_request',
    v_request.id,
    null,
    to_jsonb(v_action)
  );
  perform public.emit_domain_event(
    v_step.organization_id,
    case
      when v_decision = 'rejected' then 'approval.rejected'
      when v_decision = 'resubmit' then 'approval.resubmitted'
      else 'approval.approved'
    end,
    'approval_request',
    v_request.id,
    jsonb_build_object('official_code', p_official_code)
  );

  select status, official_code into v_request.status, v_request.official_code
  from public.approval_requests
  where id = v_request.id;

  if v_request.entity_type = 'workflow_instance_step' and v_request.status = 'completed' then
    v_outcome := case p_official_code
      when 'A' then 'complete'
      when 'B' then 'complete'
      when 'C' then 'resubmit'
      when 'D' then 'reject'
      else null
    end;

    if v_outcome is not null then
      perform public.apply_workflow_step_outcome(v_request.entity_id, v_outcome, 'approval_gate');
    end if;
  end if;

  return v_action;
end;
$$;

revoke all on function public.submit_approval_decision(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.submit_approval_decision(uuid, text, text) to authenticated;

-- Prevent starting a definition against the wrong entity type (e.g. document workflow on a project).
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
begin
  if not public.has_permission('workflow.start', p_organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  select entity_type into v_def_entity
  from public.workflow_definitions
  where id = p_definition_id;

  if v_def_entity is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_def_entity is distinct from p_entity_type then
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
    insert into public.workflow_instance_steps (
      organization_id, instance_id, step_id, step_key, sequence, status,
      assigned_user_id, assigned_role_id, assigned_department_id,
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

-- Atomic legacy project_stages completion (locks all stages of the project).
create or replace function public.complete_project_stage(p_stage_id uuid)
returns public.project_stages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.project_stages;
  v_prev public.project_stages;
  v_next public.project_stages;
  v_today date := (timezone('utc', now()))::date;
begin
  select * into v_stage
  from public.project_stages
  where id = p_stage_id
  for update;

  if v_stage.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_permission('project.update', v_stage.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_project(v_stage.project_id) then
    raise exception 'FORBIDDEN';
  end if;

  perform 1
  from public.project_stages
  where project_id = v_stage.project_id
    and organization_id = v_stage.organization_id
  for update;

  if v_stage.status in ('completed', 'skipped') then
    raise exception 'CONFLICT';
  end if;

  select * into v_prev
  from public.project_stages
  where project_id = v_stage.project_id
    and organization_id = v_stage.organization_id
    and sequence < v_stage.sequence
    and status not in ('completed', 'skipped')
  order by sequence
  limit 1;

  if v_prev.id is not null then
    raise exception 'VALIDATION';
  end if;

  update public.project_stages
  set status = 'completed',
      actual_end = v_today,
      progress_percentage = 100
  where id = v_stage.id
  returning * into v_stage;

  select * into v_next
  from public.project_stages
  where project_id = v_stage.project_id
    and organization_id = v_stage.organization_id
    and sequence > v_stage.sequence
    and status not in ('completed', 'skipped')
  order by sequence
  limit 1;

  if v_next.id is not null then
    update public.project_stages
    set status = 'in_progress',
        actual_start = coalesce(actual_start, v_today)
    where id = v_next.id;
  end if;

  perform public.log_audit(
    v_stage.organization_id,
    'project.stage.completed',
    'project_stage',
    v_stage.id,
    null,
    jsonb_build_object('automatic_next', v_next.id)
  );

  if v_next.id is not null then
    perform public.log_audit(
      v_stage.organization_id,
      'project.stage.started',
      'project_stage',
      v_next.id,
      null,
      jsonb_build_object('automatic', true)
    );
  end if;

  return v_stage;
end;
$$;

revoke all on function public.complete_project_stage(uuid)
  from public, anon, service_role;
grant execute on function public.complete_project_stage(uuid) to authenticated;

comment on function public.apply_workflow_step_outcome(uuid, text, text) is
  'Internal workflow transition. Not executable by authenticated clients.';
comment on function public.complete_project_stage(uuid) is
  'Atomic legacy project stage completion; activates the next incomplete stage.';

-- =============================================================================
-- System project lifecycle (no instance start, no project row updates).
-- Names follow existing project_stage_template_items terminology.
-- =============================================================================

-- IDs must not collide with 013/028 seeds (0001 document, 0002 submittal, 0003 shop, 0004 method, 0010 rfi).
insert into public.workflow_definitions (
  id, organization_id, code, name_ar, name_en, entity_type, status
)
select
  '40000000-0000-0000-0000-000000000005',
  null,
  'project_lifecycle',
  'دورة حياة المشروع',
  'Project lifecycle',
  'project',
  'published'
where not exists (
  select 1
  from public.workflow_definitions
  where id = '40000000-0000-0000-0000-000000000005'
     or code = 'project_lifecycle'
);

insert into public.workflow_versions (
  id, definition_id, version_number, status, published_at
)
select
  '40000000-0000-0000-0000-000000000105',
  d.id,
  1,
  'published',
  timezone('utc', now())
from public.workflow_definitions d
where d.code = 'project_lifecycle'
  and d.entity_type = 'project'
  and not exists (
    select 1 from public.workflow_versions v where v.id = '40000000-0000-0000-0000-000000000105'
  )
  and not exists (
    select 1
    from public.workflow_versions v
    where v.definition_id = d.id
      and v.version_number = 1
  );

insert into public.workflow_steps (
  id, version_id, key, name_ar, name_en, sequence, assignee_type,
  requires_approval, sla_hours, warning_hours, on_reject_step_key, on_resubmit_step_key
)
select v.id, v.version_id, v.key, v.name_ar, v.name_en, v.sequence, v.assignee_type,
       v.requires_approval, v.sla_hours, v.warning_hours, v.on_reject_step_key, v.on_resubmit_step_key
from (
  values
    ('40000000-0000-0000-0000-000000000201'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'initiation', 'البداية', 'Initiation', 1, 'role'::public.assignee_type, false, 72, 24, null::text, null::text),
    ('40000000-0000-0000-0000-000000000202'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'contract_commercial', 'إعداد العقد والتجاري', 'Contract / Commercial Setup', 2, 'role'::public.assignee_type, false, 120, 48, null::text, null::text),
    ('40000000-0000-0000-0000-000000000203'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'design_engineering', 'التصميم والهندسة', 'Design & Engineering', 3, 'role'::public.assignee_type, false, 240, 72, null::text, null::text),
    ('40000000-0000-0000-0000-000000000204'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'pre_execution_approvals', 'اعتمادات ما قبل التنفيذ', 'Pre-Execution Approvals', 4, 'role'::public.assignee_type, true, 96, 24, 'design_engineering', 'design_engineering'),
    ('40000000-0000-0000-0000-000000000205'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'procurement', 'المشتريات', 'Procurement', 5, 'role'::public.assignee_type, false, 168, 48, null::text, null::text),
    ('40000000-0000-0000-0000-000000000206'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'mobilization', 'التجهيز', 'Mobilization', 6, 'role'::public.assignee_type, false, 72, 24, null::text, null::text),
    ('40000000-0000-0000-0000-000000000207'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'execution', 'التنفيذ', 'Execution', 7, 'role'::public.assignee_type, false, 720, 168, null::text, null::text),
    ('40000000-0000-0000-0000-000000000208'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'testing_commissioning', 'الاختبار والتشغيل', 'Testing & Commissioning', 8, 'role'::public.assignee_type, false, 168, 48, null::text, null::text),
    ('40000000-0000-0000-0000-000000000209'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'handover', 'التسليم', 'Handover', 9, 'role'::public.assignee_type, false, 120, 48, null::text, null::text),
    ('40000000-0000-0000-0000-000000000210'::uuid, '40000000-0000-0000-0000-000000000105'::uuid, 'closeout', 'الإغلاق', 'Closeout', 10, 'role'::public.assignee_type, true, 96, 24, null::text, 'handover')
) as v(id, version_id, key, name_ar, name_en, sequence, assignee_type, requires_approval, sla_hours, warning_hours, on_reject_step_key, on_resubmit_step_key)
where exists (
  select 1 from public.workflow_versions wv
  where wv.id = '40000000-0000-0000-0000-000000000105'
)
  and not exists (
    select 1 from public.workflow_steps s where s.id = v.id
  );

update public.workflow_steps s
set assigned_role_id = r.id
from public.roles r
where s.version_id = '40000000-0000-0000-0000-000000000105'
  and s.key in ('initiation', 'closeout')
  and r.code = 'general_manager'
  and r.organization_id is null;

update public.workflow_steps s
set assigned_role_id = r.id
from public.roles r
where s.version_id = '40000000-0000-0000-0000-000000000105'
  and s.key = 'contract_commercial'
  and r.code = 'operations_manager'
  and r.organization_id is null;

update public.workflow_steps s
set assigned_role_id = r.id
from public.roles r
where s.version_id = '40000000-0000-0000-0000-000000000105'
  and s.key in ('design_engineering', 'testing_commissioning')
  and r.code = 'engineer'
  and r.organization_id is null;

update public.workflow_steps s
set assigned_role_id = r.id
from public.roles r
where s.version_id = '40000000-0000-0000-0000-000000000105'
  and s.key in ('pre_execution_approvals', 'mobilization', 'execution', 'handover', 'procurement')
  and r.code = 'project_manager'
  and r.organization_id is null;
