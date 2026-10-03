-- Master Touch OS — 074
-- Instance-step deadline overrides + SLA on activation.
-- Warning threshold is always due_at - warning_hours.
-- Does NOT edit 073. Does NOT start workflows. Does NOT enable WhatsApp.
-- Does NOT overwrite a manually set instance due_at on activation.

create or replace function public.workflow_instance_step_apply_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sla integer;
  v_warn integer;
  v_now timestamptz := timezone('utc', now());
begin
  if not (
    (tg_op = 'INSERT' and new.status = 'ready')
    or (tg_op = 'UPDATE' and new.status = 'ready' and old.status is distinct from 'ready')
  ) then
    return new;
  end if;

  select sla_hours, warning_hours into v_sla, v_warn
  from public.workflow_steps
  where id = new.step_id;

  new.started_at := coalesce(new.started_at, v_now);

  -- Activation SLA only when the instance step has no deadline yet.
  if new.due_at is null and v_sla is not null then
    new.due_at := v_now + make_interval(hours => v_sla);
  end if;

  if new.due_at is not null and v_warn is not null then
    new.warning_at := new.due_at - make_interval(hours => v_warn);
  end if;

  return new;
end;
$$;

drop trigger if exists workflow_instance_steps_apply_sla on public.workflow_instance_steps;
create trigger workflow_instance_steps_apply_sla
  before insert or update of status on public.workflow_instance_steps
  for each row execute function public.workflow_instance_step_apply_sla();

revoke all on function public.workflow_instance_step_apply_sla()
  from public, anon, authenticated, service_role;

create or replace function public.update_workflow_step_deadline(
  p_instance_step_id uuid,
  p_due_at timestamptz
)
returns public.workflow_instance_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.workflow_instance_steps;
  v_instance public.workflow_instances;
  v_warn integer;
  v_old timestamptz;
  v_now timestamptz := timezone('utc', now());
begin
  if p_due_at is null then
    raise exception 'VALIDATION';
  end if;

  select * into v_step
  from public.workflow_instance_steps
  where id = p_instance_step_id
  for update;

  if v_step.id is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_permission('workflow.manage', v_step.organization_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_step.status not in ('ready', 'in_progress') then
    raise exception 'CONFLICT';
  end if;

  select * into v_instance
  from public.workflow_instances
  where id = v_step.instance_id
  for update;

  if v_instance.id is null or v_instance.status in ('completed', 'cancelled') then
    raise exception 'CONFLICT';
  end if;

  if v_step.started_at is not null and p_due_at <= v_step.started_at then
    raise exception 'VALIDATION';
  end if;

  if (v_step.due_at is null or v_step.due_at > v_now) and p_due_at < v_now then
    raise exception 'VALIDATION';
  end if;

  select warning_hours into v_warn
  from public.workflow_steps
  where id = v_step.step_id;

  v_old := v_step.due_at;

  update public.workflow_instance_steps
  set
    due_at = p_due_at,
    warning_at = case
      when v_warn is not null then p_due_at - make_interval(hours => v_warn)
      else warning_at
    end
  where id = v_step.id
  returning * into v_step;

  perform public.log_audit(
    v_step.organization_id,
    'workflow.step.deadline_changed',
    'workflow_instance_step',
    v_step.id,
    jsonb_build_object('due_at', v_old, 'instance_id', v_instance.id),
    jsonb_build_object('due_at', v_step.due_at, 'instance_id', v_instance.id)
  );
  perform public.emit_domain_event(
    v_step.organization_id,
    'workflow.step.deadline_changed',
    'workflow_instance_step',
    v_step.id,
    jsonb_build_object(
      'instance_id', v_instance.id,
      'old_due_at', v_old,
      'new_due_at', v_step.due_at
    )
  );

  return v_step;
end;
$$;

revoke all on function public.update_workflow_step_deadline(uuid, timestamptz)
  from public, anon, service_role;
grant execute on function public.update_workflow_step_deadline(uuid, timestamptz) to authenticated;

-- Align existing warning_at to due_at - warning_hours. Never rewrite due_at.
update public.workflow_instance_steps s
set warning_at = s.due_at - make_interval(hours => ws.warning_hours)
from public.workflow_steps ws
where ws.id = s.step_id
  and s.due_at is not null
  and ws.warning_hours is not null
  and s.status in ('ready', 'in_progress', 'pending');
