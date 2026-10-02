-- Master Touch OS — 071
-- Organization management notification destination (nullable).
-- Additive. Does NOT modify 001–070.
-- Does NOT enable Resend. Does NOT send email.
-- Login identity is independent of this column. No backfill. No default mailbox.

alter table public.organizations
  add column if not exists management_notification_email text;

alter table public.organizations
  drop constraint if exists organizations_management_notification_email_chk;

alter table public.organizations
  add constraint organizations_management_notification_email_chk
  check (
    management_notification_email is null
    or (
      char_length(management_notification_email) >= 5
      and char_length(management_notification_email) <= 254
      and management_notification_email not like '% %'
      and management_notification_email like '%_@_%._%'
    )
  );

comment on column public.organizations.management_notification_email is
  'Optional operational mailbox for management-channel email. Not an Auth login. Null skips management email. No default.';

create or replace function public.protect_management_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.management_notification_email is not null then
    new.management_notification_email := lower(btrim(new.management_notification_email));
    if new.management_notification_email = '' then
      new.management_notification_email := null;
    end if;
  end if;

  if new.management_notification_email is not distinct from old.management_notification_email then
    return new;
  end if;

  -- Same trusted-session pattern as 066: service_role JWT or table-owner
  -- postgres/supabase_admin without authenticated/anon JWT.
  -- Authenticated users cannot enable this via GUC.
  if public.document_lifecycle_trusted_session() then
    return new;
  end if;

  if auth.uid() is null or not public.has_permission('settings.manage', new.id) then
    raise exception 'FORBIDDEN'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_management_notification_email on public.organizations;
create trigger protect_management_notification_email
  before update on public.organizations
  for each row
  execute function public.protect_management_notification_email();

revoke all on function public.protect_management_notification_email() from public, anon, authenticated;
