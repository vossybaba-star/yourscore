-- 15_draft_live.sql
-- 38-0 Live Multiplayer — live, simultaneous two-half H2H.
-- Spec: docs/superpowers/specs/2026-06-08-38-0-live-multiplayer-design.md
--
-- ADDITIVE. New working-state tables (draft_live_matches, draft_live_queue) plus
-- additive columns on draft_matches / draft_standings so a two-half match with
-- draws can be recorded and ranked. The permanent record + standings still flow
-- through the existing draft_matches / draft_standings rails. Server stays
-- authoritative: phase transitions, goal resolution and swap validation all run
-- server-side via lib/draft/* and ignore client-sent ratings.

begin;

-- 1. Permanent record: allow draws + store the two-half breakdown --------------
alter table draft_matches alter column winner_id drop not null;        -- null = draw
alter table draft_matches add column if not exists challenger_goals int;
alter table draft_matches add column if not exists opponent_goals int;
alter table draft_matches add column if not exists detail jsonb;        -- per-half + pens

-- 2. Standings: draws + losses, for a points ladder (Win=3, Draw=1) -------------
alter table draft_standings add column if not exists draws_today     int  not null default 0;
alter table draft_standings add column if not exists draws_all_time  int  not null default 0;
alter table draft_standings add column if not exists losses_today    int  not null default 0;
alter table draft_standings add column if not exists losses_all_time int  not null default 0;
alter table draft_standings add column if not exists last_played_date date;

-- 3. Live match working state (the row the phase machine advances) --------------
-- phase: lobby | reveal | pregame_swap | half1 | halftime_swap | half2
--      | draw_decision | penalties | result | abandoned
create table if not exists draft_live_matches (
  id              uuid primary key default gen_random_uuid(),
  phase           text not null default 'lobby',
  phase_deadline  timestamptz,
  join_code       text unique,                                    -- friend lobbies; null for queue-made
  ranked          boolean not null default true,
  league_id       uuid references draft_leagues(id) on delete set null,
  is_bot          boolean not null default false,

  p1_id           uuid references auth.users(id) on delete cascade,
  p2_id           uuid references auth.users(id) on delete cascade,  -- null until joined; null + is_bot = bot
  p1_ready        boolean not null default false,
  p2_ready        boolean not null default false,

  p1_squad        jsonb, p1_formation text, p1_strength numeric,
  p2_squad        jsonb, p2_formation text, p2_strength numeric,
  p1_name         text,
  p2_name         text,                                           -- opponent display (incl. disguised bot)

  p1_pregame_left int not null default 1,
  p1_half_left    int not null default 2,
  p2_pregame_left int not null default 1,
  p2_half_left    int not null default 2,

  -- draw_decision: null = undecided, true = wants penalties, false = take the draw
  p1_wants_pens   boolean,
  p2_wants_pens   boolean,

  h1_p1 int, h1_p2 int, h2_p1 int, h2_p2 int,
  pens_p1 int, pens_p2 int,
  winner_id       uuid,                                           -- null = draw or unresolved

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
alter table draft_live_matches enable row level security;
-- Participants only, so Realtime postgres_changes works for both sides. A friend
-- joining by code is resolved server-side (service role) which then sets p2_id.
drop policy if exists "draft_live participants read" on draft_live_matches;
create policy "draft_live participants read" on draft_live_matches
  for select using (auth.uid() = p1_id or auth.uid() = p2_id);
create index if not exists draft_live_code_idx  on draft_live_matches (join_code);
create index if not exists draft_live_phase_idx on draft_live_matches (phase, phase_deadline);

-- 4. Matchmaking queue ---------------------------------------------------------
create table if not exists draft_live_queue (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enqueued_at timestamptz not null default now(),
  ranked      boolean not null default true,
  league_id   uuid references draft_leagues(id) on delete cascade
);
alter table draft_live_queue enable row level security;
drop policy if exists "draft_live_queue self" on draft_live_queue;
create policy "draft_live_queue self" on draft_live_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Atomic pairing: claim the oldest compatible waiter, else enqueue self ------
-- Returns the matched waiter's user_id (caller then creates the match via service
-- role), or NULL if none was available (the caller was enqueued instead).
-- FOR UPDATE SKIP LOCKED makes concurrent callers pick *different* waiters, so two
-- players can never be paired into two matches.
create or replace function draft_live_pair(p_user uuid, p_ranked boolean, p_league uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_match uuid;
begin
  select user_id into v_match
    from draft_live_queue
   where user_id <> p_user
     and ranked = p_ranked
     and league_id is not distinct from p_league
   order by enqueued_at
   for update skip locked
   limit 1;

  if v_match is not null then
    delete from draft_live_queue where user_id in (v_match, p_user);
    return v_match;
  end if;

  insert into draft_live_queue (user_id, ranked, league_id)
  values (p_user, p_ranked, p_league)
  on conflict (user_id) do update
    set enqueued_at = now(), ranked = excluded.ranked, league_id = excluded.league_id;
  return null;
end;
$$;

-- 6. Reaper: abandon live matches stuck in a non-terminal phase past a hard
--    timeout (called by the daily reset / cron — no new infra).
create or replace function draft_live_reap()
returns void
language sql
as $$
  update draft_live_matches
     set phase = 'abandoned', updated_at = now(), resolved_at = now()
   where phase not in ('result', 'abandoned')
     and updated_at < now() - interval '10 minutes';
$$;

-- 7. Points-aware leaderboard (Win=3, Draw=1), today or all-time ----------------
create or replace function draft_leaderboard_points(p_league_id uuid, p_metric text, p_limit int default 50)
returns table (user_id uuid, display_name text, wins int, draws int, losses int, points int, rank bigint)
language sql
stable
as $$
  with rows as (
    select s.user_id, s.display_name,
           case when p_metric = 'today' then s.wins_today   else s.wins_all_time   end as wins,
           case when p_metric = 'today' then s.draws_today  else s.draws_all_time  end as draws,
           case when p_metric = 'today' then s.losses_today else s.losses_all_time end as losses
      from draft_standings s
     where s.league_id = coalesce(p_league_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  select user_id, display_name, wins, draws, losses,
         (wins * 3 + draws) as points,
         row_number() over (order by (wins * 3 + draws) desc, wins desc) as rank
    from rows
   where (wins * 3 + draws) > 0
   order by points desc, wins desc
   limit p_limit;
$$;

-- 8. Daily reset now zeroes all today-counters and reaps abandoned live matches.
create or replace function draft_reset_daily()
returns void
language plpgsql
as $$
begin
  update draft_standings
     set wins_today = 0, draws_today = 0, losses_today = 0, updated_at = now()
   where (wins_today <> 0 or draws_today <> 0 or losses_today <> 0)
     and (coalesce(last_played_date, last_win_date) is null
          or coalesce(last_played_date, last_win_date) < current_date);
  perform draft_live_reap();
end;
$$;

commit;
