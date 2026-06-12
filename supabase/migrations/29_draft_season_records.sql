-- 29_draft_season_records.sql
-- 38-0 verified season records + the "closest to 38-0 / 8-0" leaderboards, and
-- halftime-sub tracking for the live H2H impact mechanic.
--
-- A season record is only ever written by the server: the API re-validates the
-- submitted XI, recomputes the seed from the squad, and RE-RUNS the deterministic
-- season sim — the client's claimed numbers are never trusted. That is what the
-- ✓ on the leaderboard means.
--
-- ADDITIVE + idempotent (re-runnable).

begin;

-- ── Verified season records ────────────────────────────────────────────────────
create table if not exists draft_season_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null default 'Player',
  competition   text not null default 'PL',          -- 'PL' | 'LaLiga'
  seed          text not null,                       -- sorted player ids — one row per distinct XI
  wins          int  not null,
  draws         int  not null,
  losses        int  not null,
  points        int  not null,
  league_pos    int  not null,
  gf            int  not null default 0,
  ga            int  not null default 0,
  strength      numeric not null default 0,
  formation     text,
  invincible    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (user_id, seed)
);

alter table draft_season_records enable row level security;
drop policy if exists "draft_season_records own" on draft_season_records;
create policy "draft_season_records own" on draft_season_records
  for select using (auth.uid() = user_id);

create index if not exists draft_season_records_board_idx
  on draft_season_records (competition, wins desc, points desc);
create index if not exists draft_season_records_user_idx
  on draft_season_records (user_id, created_at desc);

-- ── Season leaderboard: each user's best XI, ranked by closeness to 38-0 ───────
create or replace function draft_season_leaderboard(p_competition text default 'PL', p_limit int default 50)
returns table (
  user_id uuid, display_name text, wins int, draws int, losses int,
  points int, league_pos int, strength numeric, invincible boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select * from (
    select distinct on (r.user_id)
      r.user_id, r.display_name, r.wins, r.draws, r.losses,
      r.points, r.league_pos, r.strength, r.invincible, r.created_at
    from draft_season_records r
    where r.competition = p_competition
    order by r.user_id, r.wins desc, r.points desc, r.losses asc, r.created_at asc
  ) best
  order by best.wins desc, best.points desc, best.losses asc, best.created_at asc
  limit least(greatest(p_limit, 1), 100)
$$;

-- ── World Cup leaderboard: each user's best run, ranked by closeness to 8-0 ────
-- A perfect run is 8 wins (3 group + 5 knockouts). Champions rank above
-- non-champions on equal wins.
create or replace function draft_wc_leaderboard(p_limit int default 50)
returns table (
  user_id uuid, display_name text, nation text, wins int, games int,
  status text, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select user_id, display_name, nation, wins, games, status, created_at from (
    select distinct on (r.user_id)
      r.user_id,
      coalesce(p.display_name, 'Player') as display_name,
      r.nation,
      coalesce(m.wins, 0)::int  as wins,
      coalesce(m.games, 0)::int as games,
      r.status,
      r.created_at,
      (case when r.status = 'champion' then 1 else 0 end) as champ
    from draft_wc_runs r
    left join profiles p on p.id = r.user_id
    left join lateral (
      select count(*) filter (where won is true) as wins, count(*) as games
      from draft_wc_matches where run_id = r.id
    ) m on true
    order by r.user_id,
      (case when r.status = 'champion' then 1 else 0 end) desc,
      coalesce(m.wins, 0) desc, r.created_at asc
  ) best
  where best.games > 0
  order by best.champ desc, best.wins desc, best.created_at asc
  limit least(greatest(p_limit, 1), 100)
$$;

-- ── Live H2H: track who came on at the break ──────────────────────────────────
-- Player ids subbed IN during the halftime window; the H2 sim weights them up in
-- scorer/assist picks so the change visibly pays off (sometimes).
alter table draft_live_matches
  add column if not exists p1_sub_ids jsonb not null default '[]'::jsonb,
  add column if not exists p2_sub_ids jsonb not null default '[]'::jsonb;

commit;
