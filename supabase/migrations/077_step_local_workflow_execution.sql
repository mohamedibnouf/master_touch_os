-- Master Touch OS — 077
-- Step-local operational execution for an assigned responsible_user_id.
-- Additive CREATE OR REPLACE only.
-- Does NOT rewrite 073/074/075/076 files.
-- Does NOT alter responsibility storage.
-- Does NOT add responsible_user_id to can_act_on_workflow_step.
-- Does NOT modify can_act_on_approval_step.
-- Does NOT replace update_workflow_step_deadline, assign_workflow_step_responsible,
-- or start_workflow.
-- Does NOT emit notifications or domain events from the predicate.

-- =============================================================================
-- Authoritative predicate: may the current user operationally execute THIS step?
-- Existing organizational path remains valid (workflow.manage OR
-- workflow.advance + can_act_on_workflow_step).
-- Independent path: responsible_user_id = auth.uid() with runtime checks.
-- =============================================================================

create or replace function public.can_execute_workflow_instance_step(
  p_instance_step_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_step public.workflow_instance_steps;
  v_instance public.workflow_instances;
  v_has_employee boolean := false;
  v_employee_active boolean := false;
begin
  -- A. authenticated
  if v_uid is null then
    return false;
  end if;

  if p_instance_step_id is null then
    return false;
  end if;

  -- C. instance step exists
  select * into v_step
  from public.workflow_instance_steps
  where id = p_instance_step_id;

  if v_step.id is null then
    return false;
  end if;

  -- B. workflow instance exists
  select * into v_instance
  from public.workflow_instances
  where id = v_step.instance_id;

  if v_instance.id is null then
    return false;
  end if;

  -- D. step belongs to that instance (join already enforces; keep explicit)
  if v_step.instance_id is distinct from v_instance.id then
    return false;
  end if;

  -- G / M. organization match (cross-tenant UUID fails)
  if v_step.organization_id is distinct from v_instance.organization_id then
    return false;
  end if;

  -- Existing organizational authorization (PATH 1). Status/gate remain in apply().
  if (
    public.has_permission('workflow.advance', v_step.organization_id)
    or public.has_permission('workflow.manage', v_step.organization_id)
  )
  and (
    public.has_permission('workflow.manage', v_step.organization_id)
    or public.can_act_on_workflow_step(p_instance_step_id)
  ) then
    return true;
  end if;

  -- PATH 2 — step-local responsible. Re-checked at execution time.
  if v_step.responsible_user_id is distinct from v_uid then
    return false;
  end if;

  -- E. profile exists and is active
  if not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.is_active = true
  ) then
    return false;
  end if;

  -- F + G. active organization membership matching the instance/step org
  if not exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.profile_id
    where om.profile_id = v_uid
      and om.organization_id = v_step.organization_id
      and om.status = 'active'
      and p.is_active = true
  ) then
    return false;
  end if;

  -- J / 10. employee row: if present, must be active; absence is allowed
  select
    exists (
      select 1
      from public.employees e
      where e.organization_id = v_step.organization_id
        and e.profile_id = v_uid
    ),
    exists (
      select 1
      from public.employees e
      where e.organization_id = v_step.organization_id
        and e.profile_id = v_uid
        and e.is_active = true
    )
  into v_has_employee, v_employee_active;

  if v_has_employee and not v_employee_active then
    return false;
  end if;

  -- K. step operationally actionable
  if v_step.status not in ('ready', 'in_progress') then
    return false;
  end if;

  -- L. instance not terminal / non-actionable
  if v_instance.status is distinct from 'in_progress' then
    return false;
  end if;

  -- H + I. project access + current participant architecture
  if v_instance.entity_type = 'project' then
    if v_instance.entity_id is null then
      return false;
    end if;

    if not public.can_access_project(v_instance.entity_id) then
      return false;
    end if;

    if not exists (
      select 1
      from public.projects pr
      where pr.id = v_instance.entity_id
        and pr.organization_id = v_step.organization_id
        and (
          pr.project_manager_id = v_uid
          or exists (
            select 1
            from public.project_members pm
            where pm.project_id = pr.id
              and pm.organization_id = pr.organization_id
              and pm.profile_id = v_uid
              and pm.is_active = true
          )
        )
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.can_execute_workflow_instance_step(uuid)
  from public, anon, service_role;
grant execute on function public.can_execute_workflow_instance_step(uuid) to authenticated;

-- =============================================================================
-- Direct authorization branch only: existing path OR step-local predicate.
-- Approval-gate (073 A–E), transitions, audit, events, SLA, completion unchanged.
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
