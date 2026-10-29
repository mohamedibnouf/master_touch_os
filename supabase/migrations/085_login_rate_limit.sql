-- Master Touch OS — 085
-- Shared login rate limit (replaces the per-serverless-instance in-memory counter).
-- Additive. Safe to apply before or after the app deploy: the app falls back to its
-- in-memory limiter until consume_login_attempt() exists.
--
-- Safety:
--  * Bucket keys are SHA-256 hashes computed by the app; no raw IPs or identifiers stored.
--  * RLS on, no policies, all table privileges revoked: only the security definer RPC writes.
--  * consume_login_attempt() is executable by service_role only.

create table if not exists public.auth_login_attempts (
  bucket_key text primary key check (char_length(bucket_key) between 1 and 128),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  reset_at timestamptz not null
);

create index if not exists auth_login_attempts_reset_at_idx
  on public.auth_login_attempts (reset_at);

alter table public.auth_login_attempts enable row level security;
revoke all on table public.auth_login_attempts from public, anon, authenticated;

-- Atomically records one attempt in a fixed window and returns true while the bucket
-- is within p_max_attempts.
create or replace function public.consume_login_attempt(
  p_bucket_key text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_bucket_key is null or char_length(p_bucket_key) not between 1 and 128 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_max_attempts is null or p_max_attempts < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_INPUT';
  end if;

  insert into public.auth_login_attempts as a (bucket_key, attempt_count, reset_at)
  values (p_bucket_key, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (bucket_key) do update
    set attempt_count = case when a.reset_at <= v_now then 1 else least(a.attempt_count + 1, 1000000) end,
        reset_at = case when a.reset_at <= v_now then excluded.reset_at else a.reset_at end
  returning attempt_count into v_count;

  -- Opportunistic cleanup of long-expired buckets.
  if random() < 0.02 then
    delete from public.auth_login_attempts where reset_at < v_now - interval '1 hour';
  end if;

  return v_count <= p_max_attempts;
end;
$$;

revoke all on function public.consume_login_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text, integer, integer) to service_role;
