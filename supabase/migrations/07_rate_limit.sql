-- 07_rate_limit.sql
-- M4 — Distributed rate limiting. The previous limiter lived in a per-instance
-- in-memory Map, which is bypassable across serverless instances. This moves the
-- counter into Postgres (shared across all instances) via an atomic RPC.

begin;

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

-- RLS on, no policies → only the service role (which bypasses RLS) can touch it.
alter table rate_limits enable row level security;

-- Atomically bump the counter for `p_key`, resetting the window when it has
-- elapsed. Returns true if the caller is still within `p_max` for the window.
create or replace function check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into rate_limits (key, count, window_start)
    values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

commit;
