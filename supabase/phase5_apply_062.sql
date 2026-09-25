-- Master Touch OS — 062
-- Phase 5.6: Intelligent Notification, Communication & Escalation Hub
-- Justification: notifications/notification_deliveries cannot track multi-channel
-- retries, preferences, push device ownership, or idempotent escalations.
--
-- Security: recipients must be active org members. Authenticated INSERT on
-- notifications remains denied. Preferences and push rows are owner-scoped.
-- SERVICE DEFINER RPCs are granted to service_role only.
--
-- Legacy semantics (009): deliveries.status default 'pending'; InAppChannel
-- wrote status='delivered' + attempted_at. Channel check already limits to
-- in_app|email|whatsapp|push. This migration NEVER maps unknown statuses and
-- NEVER deletes orphan deliveries.

-- ---------------------------------------------------------------------------
-- 1. Preflight: fail closed on incompatible legacy data (no silent normalize)
--    Must run before unique indexes, NOT NULL, or status tightening.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad_status text;
  v_bad_channel text;
  v_null_nid integer;
  v_orphans integer;
  v_dupes integer;
begin
  select string_agg(distinct status, ', ' order by status)
    into v_bad_status
  from public.notification_deliveries
  where status is null
     or status not in ('pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled');

  if v_bad_status is not null then
    raise exception '062 preflight: incompatible delivery status values: %', v_bad_status;
  end if;

  select string_agg(distinct channel, ', ' order by channel)
    into v_bad_channel
  from public.notification_deliveries
  where channel is null
     or channel not in ('in_app', 'email', 'whatsapp', 'push');

  if v_bad_channel is not null then
    raise exception '062 preflight: incompatible delivery channel values: %', v_bad_channel;
  end if;

  select count(*) into v_null_nid
  from public.notification_deliveries
  where notification_id is null;
  if v_null_nid > 0 then
    raise exception '062 preflight: % deliveries have null notification_id', v_null_nid;
  end if;

  select count(*) into v_orphans
  from public.notification_deliveries d
  where not exists (select 1 from public.notifications n where n.id = d.notification_id);
  if v_orphans > 0 then
    raise exception '062 preflight: % deliveries reference missing notifications (will not delete)', v_orphans;
  end if;

  select count(*) into v_dupes
  from (
    select notification_id, channel
    from public.notification_deliveries
    group by notification_id, channel
    having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception '062 preflight: % duplicate (notification_id, channel) groups (will not delete)', v_dupes;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Additive columns (nullable tenant fields until backfill + invariant)
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists event_type text,
  add column if not exists href text,
  add column if not exists dedup_key text;

create unique index if not exists notifications_dedup_uidx
  on public.notifications (organization_id, recipient_profile_id, dedup_key)
  where dedup_key is not null;

create unique index if not exists notifications_id_org_recipient_uidx
  on public.notifications (id, organization_id, recipient_profile_id);

alter table public.notification_deliveries
  add column if not exists organization_id uuid references public.organizations (id) on delete cascade,
  add column if not exists recipient_profile_id uuid references public.profiles (id) on delete cascade,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists last_error_code text,
  add column if not exists sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

-- ---------------------------------------------------------------------------
-- 3. Backfill tenant fields from the canonical notification only
-- ---------------------------------------------------------------------------
update public.notification_deliveries d
set
  organization_id = n.organization_id,
  recipient_profile_id = n.recipient_profile_id,
  updated_at = timezone('utc', now())
from public.notifications n
where n.id = d.notification_id
  and (d.organization_id is null or d.recipient_profile_id is null);

do $$
declare
  v_unresolved integer;
begin
  select count(*) into v_unresolved
  from public.notification_deliveries
  where organization_id is null or recipient_profile_id is null;
  if v_unresolved > 0 then
    raise exception '062: % deliveries still missing organization_id/recipient_profile_id (not deleted)', v_unresolved;
  end if;
end;
$$;

-- Timestamps follow historical status only. Failed/pending/processing MUST NOT
-- receive delivered_at. sent uses attempted_at only when status is already sent.
update public.notification_deliveries
set delivered_at = coalesce(delivered_at, attempted_at)
where status = 'delivered'
  and delivered_at is null
  and attempted_at is not null;

update public.notification_deliveries
set sent_at = coalesce(sent_at, attempted_at)
where status = 'sent'
  and sent_at is null
  and attempted_at is not null;

alter table public.notification_deliveries
  alter column organization_id set not null,
  alter column recipient_profile_id set not null;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_notification_tenant_fk;

alter table public.notification_deliveries
  add constraint notification_deliveries_notification_tenant_fk
  foreign key (notification_id, organization_id, recipient_profile_id)
  references public.notifications (id, organization_id, recipient_profile_id)
  on delete cascade;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'delivered', 'failed', 'cancelled'));

create unique index if not exists notification_deliveries_channel_uidx
  on public.notification_deliveries (notification_id, channel);

create index if not exists notification_deliveries_retry_idx
  on public.notification_deliveries (status, next_attempt_at)
  where status in ('pending', 'failed')
    and channel in ('email', 'whatsapp', 'push');

-- ---------------------------------------------------------------------------
-- 4. Preferences, push, escalations, job runs
-- ---------------------------------------------------------------------------
create type public.notification_category as enum (
  'WORK',
  'APPROVALS',
  'HR',
  'ATTENDANCE',
  'PROJECTS',
  'MANAGEMENT',
  'PAYROLL'
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  category public.notification_category not null,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp', 'push')),
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, profile_id, category, channel)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (endpoint)
);

create index push_subscriptions_owner_idx
  on public.push_subscriptions (organization_id, profile_id)
  where revoked_at is null;

create or replace function public.push_subscriptions_protect_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.profile_id is distinct from old.profile_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'push subscription owner is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscriptions_protect_owner on public.push_subscriptions;
create trigger push_subscriptions_protect_owner
  before update on public.push_subscriptions
  for each row execute function public.push_subscriptions_protect_owner();

create table public.notification_escalations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  level integer not null default 1 check (level >= 1 and level <= 5),
  from_profile_id uuid references public.profiles (id) on delete set null,
  to_profile_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, entity_type, entity_id, level, to_profile_id)
);

create table public.notification_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  window_key text not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error_code text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  unique (job_name, window_key)
);

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_escalations enable row level security;
alter table public.notification_job_runs enable row level security;

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

drop policy if exists notification_preferences_write on public.notification_preferences;
drop policy if exists notification_preferences_insert on public.notification_preferences;
drop policy if exists notification_preferences_update on public.notification_preferences;
drop policy if exists notification_preferences_delete on public.notification_preferences;

create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
    and not (channel = 'in_app' and enabled = false and category in ('WORK', 'APPROVALS', 'PAYROLL'))
  );

create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  )
  with check (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
    and not (channel = 'in_app' and enabled = false and category in ('WORK', 'APPROVALS', 'PAYROLL'))
  );

-- Deleting a mandatory in-app row must not bypass channel resolution; the row
-- is also forbidden from being deleted so absence cannot be forced for those.
create policy notification_preferences_delete on public.notification_preferences
  for delete to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
    and not (channel = 'in_app' and category in ('WORK', 'APPROVALS', 'PAYROLL'))
  );

drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_write on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  )
  with check (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (
    profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

drop policy if exists notification_escalations_select on public.notification_escalations;
create policy notification_escalations_select on public.notification_escalations
  for select to authenticated
  using (
    public.has_permission('reports.management.read', organization_id)
    or to_profile_id = auth.uid()
    or from_profile_id = auth.uid()
  );

drop policy if exists notification_job_runs_select on public.notification_job_runs;
create policy notification_job_runs_select on public.notification_job_runs
  for select to authenticated
  using (public.has_permission('audit.read', organization_id));

drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select on public.notification_deliveries
  for select to authenticated
  using (
    recipient_profile_id = auth.uid()
    and public.is_organization_member(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Service-role RPCs
-- in_app deliveries are recorded as delivered (canonical row is notifications).
-- External channels remain pending for the worker. Claim never picks in_app.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_operational_notification(
  p_organization_id uuid,
  p_recipient_profile_id uuid,
  p_event_type text,
  p_type text,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_href text,
  p_priority public.notification_priority,
  p_dedup_key text,
  p_channels text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_channel text;
  v_in_app boolean;
begin
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'notification title required';
  end if;
  if p_href is not null and (p_href not like '/%' or p_href like '//%' or p_href like '%:%') then
    raise exception 'unsafe notification href';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.profile_id
    where m.organization_id = p_organization_id
      and m.profile_id = p_recipient_profile_id
      and m.status = 'active'
      and p.is_active = true
  ) then
    raise exception 'recipient not an active organization member';
  end if;

  if p_dedup_key is not null then
    insert into public.notifications (
      organization_id,
      recipient_profile_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      priority,
      event_type,
      href,
      dedup_key
    ) values (
      p_organization_id,
      p_recipient_profile_id,
      p_type,
      left(p_title, 200),
      left(p_message, 500),
      p_entity_type,
      p_entity_id,
      coalesce(p_priority, 'normal'),
      p_event_type,
      p_href,
      p_dedup_key
    )
    on conflict (organization_id, recipient_profile_id, dedup_key) where dedup_key is not null
    do nothing
    returning id into v_id;

    if v_id is null then
      select n.id into v_id
      from public.notifications n
      where n.organization_id = p_organization_id
        and n.recipient_profile_id = p_recipient_profile_id
        and n.dedup_key = p_dedup_key
      limit 1;
    end if;
  else
    insert into public.notifications (
      organization_id,
      recipient_profile_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      priority,
      event_type,
      href
    ) values (
      p_organization_id,
      p_recipient_profile_id,
      p_type,
      left(p_title, 200),
      left(p_message, 500),
      p_entity_type,
      p_entity_id,
      coalesce(p_priority, 'normal'),
      p_event_type,
      p_href
    )
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'notification upsert failed';
  end if;

  foreach v_channel in array coalesce(p_channels, array['in_app'])
  loop
    if v_channel not in ('in_app', 'email', 'whatsapp', 'push') then
      continue;
    end if;
    v_in_app := v_channel = 'in_app';
    insert into public.notification_deliveries (
      notification_id,
      organization_id,
      recipient_profile_id,
      channel,
      status,
      attempted_at,
      delivered_at,
      next_attempt_at
    ) values (
      v_id,
      p_organization_id,
      p_recipient_profile_id,
      v_channel,
      case when v_in_app then 'delivered' else 'pending' end,
      case when v_in_app then timezone('utc', now()) else null end,
      case when v_in_app then timezone('utc', now()) else null end,
      case when v_in_app then null else timezone('utc', now()) end
    )
    on conflict (notification_id, channel) do nothing;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.upsert_operational_notification(
  uuid, uuid, text, text, text, text, text, uuid, text, public.notification_priority, text, text[]
) from public;
revoke all on function public.upsert_operational_notification(
  uuid, uuid, text, text, text, text, text, uuid, text, public.notification_priority, text, text[]
) from anon;
revoke all on function public.upsert_operational_notification(
  uuid, uuid, text, text, text, text, text, uuid, text, public.notification_priority, text, text[]
) from authenticated;
grant execute on function public.upsert_operational_notification(
  uuid, uuid, text, text, text, text, text, uuid, text, public.notification_priority, text, text[]
) to service_role;

create or replace function public.claim_notification_deliveries(p_limit integer)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select d.id
    from public.notification_deliveries d
    where d.status in ('pending', 'failed')
      and d.channel in ('email', 'whatsapp', 'push')
      and d.attempt_count < 5
      and (d.next_attempt_at is null or d.next_attempt_at <= timezone('utc', now()))
    order by d.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.notification_deliveries d
  set
    status = 'processing',
    attempt_count = d.attempt_count + 1,
    attempted_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  from picked
  where d.id = picked.id
  returning d.*;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer) from public;
revoke all on function public.claim_notification_deliveries(integer) from anon;
revoke all on function public.claim_notification_deliveries(integer) from authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

comment on function public.upsert_operational_notification is
  'Service-role only. Tenant-bound notification upsert. in_app is recorded delivered; external channels stay pending.';
comment on function public.claim_notification_deliveries is
  'Service-role only. Claims a bounded batch of email/whatsapp/push deliveries (SKIP LOCKED). Never claims in_app.';

-- Table privileges: authenticated uses RLS. No client insert of notifications.
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_escalations to authenticated;
grant select on public.notification_job_runs to authenticated;
revoke insert, delete on public.notifications from anon, authenticated;
revoke insert, update, delete on public.notification_deliveries from anon, authenticated;
