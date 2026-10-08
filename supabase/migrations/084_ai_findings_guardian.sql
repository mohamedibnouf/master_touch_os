-- Master Touch OS — 084
-- Durable AI Guardian findings (deterministic risk register).
-- Additive. Do not apply until Production migration approval.
--
-- Safety:
--  * Mixed-sensitivity rows are classified from category (generated column).
--  * SELECT is RLS-gated by class: operations / hr / payroll.
--  * Authenticated clients cannot INSERT/UPDATE/DELETE via PostgREST.
--  * Review mutations go through review_ai_finding() only.
--  * Alerts default OFF until a manager enables them after baseline.
--  * Service-role writes findings. Anon has no access.
--  * Does not modify earlier migrations. Extra columns on notification_job_runs are additive.

create table if not exists public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  rule_id text not null,
  category text not null check (category in (
    'PROJECT_DELAY', 'APPROVAL_DELAY', 'PROCUREMENT', 'COMMERCIAL',
    'HR', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'COMPLIANCE'
  )),
  sensitivity_class text generated always as (
    case
      when category = 'PAYROLL' then 'payroll'
      when category in ('HR', 'ATTENDANCE', 'LEAVE', 'COMPLIANCE') then 'hr'
      else 'operations'
    end
  ) stored,
  severity text not null check (severity in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  title_ar text not null,
  title_en text not null,
  explanation_ar text not null,
  explanation_en text not null,
  recommended_action_ar text not null default 'راجع السجل من شاشات النظام المعتمدة. لا يُنفَّذ أي إجراء تلقائي.',
  evidence jsonb not null default '{}'::jsonb,
  href text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'in_review', 'resolved', 'dismissed')),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  assigned_reviewer_id uuid references public.profiles (id) on delete set null,
  review_note text,
  dedup_key text not null,
  detection_version text not null,
  detector text not null default 'rule' check (detector in ('rule', 'model')),
  escalation_count integer not null default 0 check (escalation_count >= 0),
  last_in_app_notified_at timestamptz,
  last_email_notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_findings_dedup_unique unique (organization_id, dedup_key),
  constraint ai_findings_source_type_chk check (char_length(source_type) between 1 and 64),
  constraint ai_findings_rule_id_chk check (char_length(rule_id) between 1 and 80),
  constraint ai_findings_evidence_object_chk check (jsonb_typeof(evidence) = 'object'),
  constraint ai_findings_evidence_no_restricted_keys_chk check (
    not (evidence ?| array['iban', 'salary', 'net_pay', 'iqama_number', 'passport_number', 'gosi_number', 'phone', 'employee_id', 'employee_name'])
  )
);

create index if not exists ai_findings_org_status_severity_idx
  on public.ai_findings (organization_id, status, severity, last_seen_at desc);

create index if not exists ai_findings_org_class_idx
  on public.ai_findings (organization_id, sensitivity_class);

create table if not exists public.ai_guardian_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  alerts_enabled boolean not null default false,
  baseline_completed_at timestamptz,
  alerts_enabled_at timestamptz,
  alerts_enabled_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.notification_job_runs
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_generation integer not null default 0;

comment on table public.ai_findings is
  'Deterministic Guardian findings. Mixed sensitivity; RLS by sensitivity_class. detector=model never emails.';

alter table public.ai_findings enable row level security;
alter table public.ai_guardian_settings enable row level security;

create or replace function public.has_management_ai_view(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(p_organization_id)
    and (
      public.has_permission('reports.management.read', p_organization_id, 'organization', null)
      or public.has_permission('ai.management.view', p_organization_id, 'organization', null)
    );
$$;

create or replace function public.can_read_ai_finding(p_organization_id uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_management_ai_view(p_organization_id)
    and case
      when p_category = 'PAYROLL' then (
        public.has_permission('payroll.view_all', p_organization_id, 'organization', null)
        or public.has_permission('payroll.review', p_organization_id, 'organization', null)
        or public.has_permission('payroll.approve', p_organization_id, 'organization', null)
        or public.has_permission('payroll.prepare', p_organization_id, 'organization', null)
      )
      when p_category in ('HR', 'ATTENDANCE', 'LEAVE', 'COMPLIANCE') then (
        public.has_permission('employee.manage', p_organization_id, 'organization', null)
        or public.has_permission('employee_compliance.read', p_organization_id, 'organization', null)
        or public.has_permission('employee_contract.read', p_organization_id, 'organization', null)
        or public.has_permission('attendance.view_all', p_organization_id, 'organization', null)
        or public.has_permission('attendance.manage', p_organization_id, 'organization', null)
        or public.has_permission('leave.view_all', p_organization_id, 'organization', null)
        or public.has_permission('leave.manage', p_organization_id, 'organization', null)
      )
      when p_category in ('PROJECT_DELAY', 'APPROVAL_DELAY', 'PROCUREMENT', 'COMMERCIAL') then true
      else false
    end;
$$;

create or replace function public.protect_ai_findings_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.dedup_key is distinct from old.dedup_key
      or new.source_type is distinct from old.source_type
      or new.source_id is distinct from old.source_id
      or new.rule_id is distinct from old.rule_id
      or new.category is distinct from old.category
    then
      raise exception 'ai_findings identity columns are immutable';
    end if;
    -- Do not use a custom GUC. Authenticated sessions can SET custom GUCs.
    -- service_role: Guardian scan writes. postgres/supabase_admin: review RPC (definer).
    if current_user = 'service_role' then
      new.updated_at := timezone('utc', now());
      return new;
    end if;
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception 'ai_findings row updates must use review_ai_finding()';
    end if;
    new.severity := old.severity;
    new.evidence := old.evidence;
    new.title_ar := old.title_ar;
    new.title_en := old.title_en;
    new.explanation_ar := old.explanation_ar;
    new.explanation_en := old.explanation_en;
    new.recommended_action_ar := old.recommended_action_ar;
    new.href := old.href;
    new.detector := old.detector;
    new.detection_version := old.detection_version;
    new.first_seen_at := old.first_seen_at;
    new.last_seen_at := old.last_seen_at;
    new.last_in_app_notified_at := old.last_in_app_notified_at;
    new.last_email_notified_at := old.last_email_notified_at;
    new.escalation_count := old.escalation_count;
    new.updated_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_ai_findings on public.ai_findings;
create trigger trg_protect_ai_findings
  before update on public.ai_findings
  for each row execute function public.protect_ai_findings_identity();

create or replace function public.review_ai_finding(
  p_finding_id uuid,
  p_status text,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_category text;
  v_status text;
  v_allowed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select organization_id, category, status
    into v_organization_id, v_category, v_status
  from public.ai_findings
  where id = p_finding_id;
  if not found then
    raise exception 'finding not found';
  end if;
  if not public.can_read_ai_finding(v_organization_id, v_category) then
    raise exception 'not authorized';
  end if;
  if p_status not in ('open', 'acknowledged', 'in_review', 'resolved', 'dismissed') then
    raise exception 'invalid status';
  end if;
  if v_status = 'open' and p_status in ('acknowledged', 'in_review', 'resolved', 'dismissed') then
    v_allowed := true;
  elsif v_status = 'acknowledged' and p_status in ('open', 'in_review', 'resolved', 'dismissed') then
    v_allowed := true;
  elsif v_status = 'in_review' and p_status in ('acknowledged', 'resolved', 'dismissed') then
    v_allowed := true;
  end if;
  if not v_allowed then
    raise exception 'invalid finding transition';
  end if;
  if p_status = 'dismissed' and (p_review_note is null or char_length(trim(p_review_note)) < 3) then
    raise exception 'dismiss requires a reason';
  end if;
  if p_status = 'resolved' and (p_review_note is null or char_length(trim(p_review_note)) < 3) then
    raise exception 'resolve requires a verification note';
  end if;

  update public.ai_findings
  set
    status = p_status,
    review_note = nullif(trim(p_review_note), ''),
    assigned_reviewer_id = case when p_status = 'in_review' then auth.uid() else assigned_reviewer_id end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then timezone('utc', now()) else null end,
    updated_at = timezone('utc', now())
  where id = p_finding_id;

  perform public.log_audit(
    v_organization_id,
    'guardian.finding.status',
    'ai_finding',
    p_finding_id,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', p_status),
    null, null, null
  );
end;
$$;

create or replace function public.enable_guardian_alerts(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baseline timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.has_management_ai_view(p_organization_id) then
    raise exception 'not authorized';
  end if;
  if not (
    public.has_permission('settings.manage', p_organization_id, 'organization', null)
    or public.has_permission('ai.management.view', p_organization_id, 'organization', null)
  ) then
    raise exception 'not authorized';
  end if;

  select baseline_completed_at into v_baseline
  from public.ai_guardian_settings
  where organization_id = p_organization_id;

  if v_baseline is null then
    raise exception 'baseline scan required before enabling alerts';
  end if;

  insert into public.ai_guardian_settings (
    organization_id, alerts_enabled, alerts_enabled_at, alerts_enabled_by, baseline_completed_at
  ) values (
    p_organization_id, true, timezone('utc', now()), auth.uid(), v_baseline
  )
  on conflict (organization_id) do update
    set alerts_enabled = true,
        alerts_enabled_at = timezone('utc', now()),
        alerts_enabled_by = auth.uid(),
        updated_at = timezone('utc', now());
end;
$$;

create or replace function public.claim_guardian_job(
  p_window_key text,
  p_stale_seconds integer default 3000,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_id uuid;
  v_row public.notification_job_runs%rowtype;
  v_processed jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_window_key is null or char_length(p_window_key) < 8 then
    raise exception 'invalid window';
  end if;
  if p_stale_seconds is null or p_stale_seconds < 60 or p_stale_seconds > 86400 then
    raise exception 'invalid stale interval';
  end if;

  insert into public.notification_job_runs (
    job_name, window_key, status, heartbeat_at, details, lease_generation
  ) values (
    'guardian.scan', p_window_key, 'running', v_now, coalesce(p_details, '{}'::jsonb), 1
  )
  on conflict (job_name, window_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object(
      'run', true,
      'job_id', v_id,
      'lease_generation', 1,
      'skip', null,
      'processed_organization_ids', v_processed
    );
  end if;

  select * into v_row
  from public.notification_job_runs
  where job_name = 'guardian.scan' and window_key = p_window_key
  for update;

  if not found then
    return jsonb_build_object('run', false, 'job_id', null, 'lease_generation', 0, 'skip', 'claim_conflict', 'processed_organization_ids', v_processed);
  end if;

  if v_row.status = 'completed' then
    return jsonb_build_object(
      'run', false,
      'job_id', v_row.id,
      'lease_generation', v_row.lease_generation,
      'skip', 'window_completed',
      'processed_organization_ids', coalesce(v_row.details -> 'processed_organization_ids', v_processed)
    );
  end if;

  if v_row.status = 'running'
     and coalesce(v_row.heartbeat_at, v_row.started_at) > v_now - make_interval(secs => p_stale_seconds)
  then
    return jsonb_build_object(
      'run', false,
      'job_id', v_row.id,
      'lease_generation', v_row.lease_generation,
      'skip', 'window_running',
      'processed_organization_ids', coalesce(v_row.details -> 'processed_organization_ids', v_processed)
    );
  end if;

  update public.notification_job_runs
  set
    status = 'running',
    heartbeat_at = v_now,
    finished_at = null,
    error_code = null,
    lease_generation = v_row.lease_generation + 1,
    details = coalesce(v_row.details, '{}'::jsonb) || jsonb_build_object('takeover', true)
  where id = v_row.id
  returning lease_generation into v_row.lease_generation;

  return jsonb_build_object(
    'run', true,
    'job_id', v_row.id,
    'lease_generation', v_row.lease_generation,
    'skip', null,
    'processed_organization_ids', coalesce(v_row.details -> 'processed_organization_ids', v_processed)
  );
end;
$$;

create or replace function public.guardian_commit_org_scan(
  p_job_id uuid,
  p_lease_generation integer,
  p_organization_id uuid,
  p_now timestamptz,
  p_upserts jsonb,
  p_resolve_ids uuid[],
  p_checkpoint jsonb,
  p_record_baseline boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  update public.notification_job_runs
  set
    heartbeat_at = p_now,
    details = coalesce(details, '{}'::jsonb) || coalesce(p_checkpoint, '{}'::jsonb)
  where id = p_job_id
    and lease_generation = p_lease_generation
    and status = 'running';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'stale_guardian_lease';
  end if;

  insert into public.ai_findings (
    id, organization_id, source_type, source_id, rule_id, category, severity,
    title_ar, title_en, explanation_ar, explanation_en, recommended_action_ar,
    evidence, href, status, first_seen_at, last_seen_at, resolved_at,
    assigned_reviewer_id, review_note, dedup_key, detection_version, detector,
    escalation_count, last_in_app_notified_at, last_email_notified_at
  )
  select
    coalesce(nullif(r->>'id', '')::uuid, gen_random_uuid()),
    (r->>'organization_id')::uuid,
    r->>'source_type',
    (r->>'source_id')::uuid,
    r->>'rule_id',
    r->>'category',
    r->>'severity',
    r->>'title_ar',
    r->>'title_en',
    r->>'explanation_ar',
    r->>'explanation_en',
    coalesce(r->>'recommended_action_ar', ''),
    coalesce(r->'evidence', '{}'::jsonb),
    r->>'href',
    coalesce(r->>'status', 'open'),
    coalesce((r->>'first_seen_at')::timestamptz, p_now),
    coalesce((r->>'last_seen_at')::timestamptz, p_now),
    nullif(r->>'resolved_at', '')::timestamptz,
    nullif(r->>'assigned_reviewer_id', '')::uuid,
    nullif(r->>'review_note', ''),
    r->>'dedup_key',
    r->>'detection_version',
    coalesce(r->>'detector', 'rule'),
    coalesce((r->>'escalation_count')::integer, 0),
    nullif(r->>'last_in_app_notified_at', '')::timestamptz,
    nullif(r->>'last_email_notified_at', '')::timestamptz
  from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) as r
  on conflict (organization_id, dedup_key) do update set
    severity = excluded.severity,
    title_ar = excluded.title_ar,
    title_en = excluded.title_en,
    explanation_ar = excluded.explanation_ar,
    explanation_en = excluded.explanation_en,
    recommended_action_ar = excluded.recommended_action_ar,
    evidence = excluded.evidence,
    href = excluded.href,
    status = excluded.status,
    last_seen_at = excluded.last_seen_at,
    resolved_at = excluded.resolved_at,
    assigned_reviewer_id = excluded.assigned_reviewer_id,
    review_note = excluded.review_note,
    detection_version = excluded.detection_version,
    detector = excluded.detector,
    escalation_count = excluded.escalation_count,
    last_in_app_notified_at = excluded.last_in_app_notified_at,
    last_email_notified_at = excluded.last_email_notified_at,
    updated_at = p_now;

  if p_resolve_ids is not null and array_length(p_resolve_ids, 1) is not null then
    update public.ai_findings
    set status = 'resolved', resolved_at = p_now, last_seen_at = p_now, updated_at = p_now
    where organization_id = p_organization_id
      and id = any (p_resolve_ids);
  end if;

  if p_record_baseline then
    insert into public.ai_guardian_settings (organization_id, alerts_enabled, baseline_completed_at, updated_at)
    values (p_organization_id, false, p_now, p_now)
    on conflict (organization_id) do update
      set baseline_completed_at = coalesce(public.ai_guardian_settings.baseline_completed_at, excluded.baseline_completed_at),
          updated_at = p_now;
  end if;

  return true;
end;
$$;

create or replace function public.guardian_finish_job(
  p_job_id uuid,
  p_lease_generation integer,
  p_status text,
  p_error_code text default null,
  p_details jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid job status';
  end if;
  update public.notification_job_runs
  set
    status = p_status,
    finished_at = timezone('utc', now()),
    heartbeat_at = timezone('utc', now()),
    error_code = p_error_code,
    details = coalesce(details, '{}'::jsonb) || coalesce(p_details, '{}'::jsonb)
  where id = p_job_id
    and lease_generation = p_lease_generation;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'stale_guardian_lease';
  end if;
  return true;
end;
$$;

create or replace function public.guardian_mark_notified(
  p_job_id uuid,
  p_lease_generation integer,
  p_finding_id uuid,
  p_now timestamptz,
  p_email boolean
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  update public.notification_job_runs
  set heartbeat_at = p_now
  where id = p_job_id
    and lease_generation = p_lease_generation
    and status = 'running';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'stale_guardian_lease';
  end if;
  update public.ai_findings
  set
    last_in_app_notified_at = p_now,
    last_email_notified_at = case when p_email then p_now else last_email_notified_at end,
    escalation_count = escalation_count + 1,
    updated_at = p_now
  where id = p_finding_id;
  return true;
end;
$$;

drop policy if exists ai_findings_select on public.ai_findings;
create policy ai_findings_select on public.ai_findings
  for select to authenticated
  using (public.can_read_ai_finding(organization_id, category));

drop policy if exists ai_findings_update on public.ai_findings;
drop policy if exists ai_findings_insert on public.ai_findings;
drop policy if exists ai_findings_delete on public.ai_findings;

drop policy if exists ai_guardian_settings_select on public.ai_guardian_settings;
create policy ai_guardian_settings_select on public.ai_guardian_settings
  for select to authenticated
  using (public.has_management_ai_view(organization_id));

revoke all on function public.has_management_ai_view(uuid) from public, anon;
revoke all on function public.can_read_ai_finding(uuid, text) from public, anon;
revoke all on function public.review_ai_finding(uuid, text, text) from public, anon;
revoke all on function public.enable_guardian_alerts(uuid) from public, anon;
revoke all on function public.claim_guardian_job(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.guardian_commit_org_scan(uuid, integer, uuid, timestamptz, jsonb, uuid[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.guardian_finish_job(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.guardian_mark_notified(uuid, integer, uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.has_management_ai_view(uuid) to authenticated, service_role;
grant execute on function public.can_read_ai_finding(uuid, text) to authenticated, service_role;
grant execute on function public.review_ai_finding(uuid, text, text) to authenticated;
grant execute on function public.enable_guardian_alerts(uuid) to authenticated;
grant execute on function public.claim_guardian_job(text, integer, jsonb) to service_role;
grant execute on function public.guardian_commit_org_scan(uuid, integer, uuid, timestamptz, jsonb, uuid[], jsonb, boolean) to service_role;
grant execute on function public.guardian_finish_job(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.guardian_mark_notified(uuid, integer, uuid, timestamptz, boolean) to service_role;
revoke all on function public.protect_ai_findings_identity() from public, anon, authenticated;
grant execute on function public.protect_ai_findings_identity() to service_role;

revoke all on table public.ai_findings from public, anon, authenticated;
grant select on table public.ai_findings to authenticated;
grant all on table public.ai_findings to service_role;

revoke all on table public.ai_guardian_settings from public, anon, authenticated;
grant select on table public.ai_guardian_settings to authenticated;
grant all on table public.ai_guardian_settings to service_role;
