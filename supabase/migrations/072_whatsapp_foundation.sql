-- Master Touch OS — 072
-- Internal WhatsApp foundation: E.164 contact phone, operational opt-in,
-- organization management WhatsApp destination.
-- Additive. Does NOT modify 001–071.
-- Does NOT enable Meta. Does NOT send WhatsApp. No phone backfill. No auto opt-in.

alter table public.profiles
  add column if not exists whatsapp_opt_in boolean not null default false;

alter table public.profiles
  add column if not exists whatsapp_opt_in_at timestamptz;

comment on column public.profiles.phone is
  'Optional general contact/mobile in E.164. Used for personal WhatsApp only with explicit opt-in.';

comment on column public.profiles.whatsapp_opt_in is
  'Operational WhatsApp consent. Default false. Not marketing consent. Never auto-enabled.';

comment on column public.profiles.whatsapp_opt_in_at is
  'Set when operational WhatsApp opt-in becomes true. Preserved on later opt-out.';

alter table public.profiles
  drop constraint if exists profiles_phone_e164_chk;

alter table public.profiles
  add constraint profiles_phone_e164_chk
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

alter table public.profiles
  drop constraint if exists profiles_whatsapp_opt_in_phone_chk;

alter table public.profiles
  add constraint profiles_whatsapp_opt_in_phone_chk
  check (whatsapp_opt_in = false or phone is not null);

create or replace function public.protect_profile_whatsapp_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null then
    new.phone := btrim(new.phone);
    if new.phone = '' then
      new.phone := null;
    end if;
  end if;

  if new.phone is null then
    new.whatsapp_opt_in := false;
  end if;

  if tg_op = 'INSERT' then
    if new.whatsapp_opt_in is true then
      new.whatsapp_opt_in_at := coalesce(new.whatsapp_opt_in_at, now());
    end if;
    return new;
  end if;

  if new.whatsapp_opt_in is true and coalesce(old.whatsapp_opt_in, false) is false then
    new.whatsapp_opt_in_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_whatsapp_contact on public.profiles;
create trigger protect_profile_whatsapp_contact
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_whatsapp_contact();

revoke all on function public.protect_profile_whatsapp_contact() from public, anon, authenticated;

alter table public.organizations
  add column if not exists management_notification_whatsapp text;

alter table public.organizations
  drop constraint if exists organizations_management_notification_whatsapp_chk;

alter table public.organizations
  add constraint organizations_management_notification_whatsapp_chk
  check (
    management_notification_whatsapp is null
    or management_notification_whatsapp ~ '^\+[1-9][0-9]{7,14}$'
  );

comment on column public.organizations.management_notification_whatsapp is
  'Optional operational WhatsApp destination (E.164). Explicit admin configuration. Not inferred from staff phones. Null skips management WhatsApp.';

create or replace function public.protect_management_notification_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.management_notification_whatsapp is not null then
    new.management_notification_whatsapp := btrim(new.management_notification_whatsapp);
    if new.management_notification_whatsapp = '' then
      new.management_notification_whatsapp := null;
    end if;
  end if;

  if new.management_notification_whatsapp is not distinct from old.management_notification_whatsapp then
    return new;
  end if;

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

drop trigger if exists protect_management_notification_whatsapp on public.organizations;
create trigger protect_management_notification_whatsapp
  before update on public.organizations
  for each row
  execute function public.protect_management_notification_whatsapp();

revoke all on function public.protect_management_notification_whatsapp() from public, anon, authenticated;
