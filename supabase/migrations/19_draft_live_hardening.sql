-- 19_draft_live_hardening.sql
-- Hardening for 38-0 live multiplayer ahead of real traffic. Additive.
--   1. draft_credit_result(): atomic standings increment (replaces the client-side
--      read-modify-write in creditResult, which could lose increments when two
--      finalizes for the same user overlapped).
--   2. Schedule draft_live_reap() on its own 2-minute pg_cron so abandoned matches
--      clear promptly (it previously only ran inside the once-daily reset).

begin;

-- 1. Atomic per-result standings credit (points ladder: Win=3, Draw=1) -----------
-- Single INSERT … ON CONFLICT … SET col = col + n statement → safe under concurrency.
-- Also does the lazy daily reset: today-counters reset when last_played_date < today.
create or replace function draft_credit_result(
  p_user uuid,
  p_name text,
  p_result text,                 -- 'win' | 'draw' | 'loss'
  p_league uuid default '00000000-0000-0000-0000-000000000000'::uuid
)
returns void
language plpgsql
as $$
declare
  v_league uuid := coalesce(p_league, '00000000-0000-0000-0000-000000000000'::uuid);
  v_w int := (p_result = 'win')::int;
  v_d int := (p_result = 'draw')::int;
  v_l int := (p_result = 'loss')::int;
begin
  insert into draft_standings as s (
    user_id, display_name, league_id,
    wins_today, draws_today, losses_today,
    wins_all_time, draws_all_time, losses_all_time,
    last_played_date, last_win_date, updated_at
  )
  values (
    p_user, p_name, v_league,
    v_w, v_d, v_l,
    v_w, v_d, v_l,
    current_date, case when p_result = 'win' then current_date else null end, now()
  )
  on conflict (user_id, league_id) do update set
    display_name    = excluded.display_name,
    wins_today      = (case when s.last_played_date = current_date then s.wins_today   else 0 end) + v_w,
    draws_today     = (case when s.last_played_date = current_date then s.draws_today  else 0 end) + v_d,
    losses_today    = (case when s.last_played_date = current_date then s.losses_today else 0 end) + v_l,
    wins_all_time   = s.wins_all_time   + v_w,
    draws_all_time  = s.draws_all_time  + v_d,
    losses_all_time = s.losses_all_time + v_l,
    last_played_date = current_date,
    last_win_date   = case when p_result = 'win' then current_date else s.last_win_date end,
    updated_at      = now();
end;
$$;

-- 2. Reap abandoned live matches on their own cadence (every 2 min), independent of
--    the daily reset. Idempotent re-schedule.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'draft-live-reap') then
      perform cron.unschedule('draft-live-reap');
    end if;
    perform cron.schedule('draft-live-reap', '*/2 * * * *', 'select public.draft_live_reap()');
  end if;
end $$;

commit;
