-- 105 — count Games played, so the rating ask can be paced by play rather than
-- by the calendar. A player who opens the app twice a week and one who grinds
-- ten Games a night should not be on the same schedule.
--
-- profiles.games_played exists and is useless: 0 on all 10,001 rows, never
-- written by anything. Rather than repair a column nothing owns, this keeps its
-- own counter, incremented by /api/review-prompt on each game-end screen.
--
-- Seeded from the real play records so a player with 500 Games behind them is
-- not treated as brand new. The union below IS what "a Game" means for pacing:
--   quiz_attempts       Quiz
--   p10_attempts        Perfect 10
--   game_runs           Higher or Lower, Guess the Player
--   draft_matches       38-0 async, both sides
--   draft_live_matches  38-0 live, both sides
--   draft_wc_runs       WC Mastermind (retired, but it is play they did)

create table if not exists player_game_counts (
  user_id uuid primary key references profiles(id) on delete cascade,
  games integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table player_game_counts enable row level security;
-- No policies: service role only. Nothing client-side reads or writes this.

insert into player_game_counts (user_id, games)
select uid, count(*) from (
  select user_id as uid from quiz_attempts where user_id is not null
  union all select user_id from p10_attempts where user_id is not null
  union all select user_id from game_runs where user_id is not null
  union all select challenger_id from draft_matches where challenger_id is not null
  union all select opponent_id from draft_matches where opponent_id is not null
  union all select p1_id from draft_live_matches where p1_id is not null
  union all select p2_id from draft_live_matches where p2_id is not null
  union all select user_id from draft_wc_runs where user_id is not null
) a
where exists (select 1 from profiles p where p.id = a.uid)
group by uid
on conflict (user_id) do nothing;

-- How many Games the player had when we last asked them. The schedule is
-- "N Games since the previous ask", which is the only form that works for both
-- a new account and a seeded veteran: cumulative thresholds would fire every
-- remaining ask back to back for anyone seeded above the top threshold.
alter table review_prompts
  add column if not exists games_at integer;

-- Increment and return in one round trip. Called once per game-end screen, so
-- it must be cheap and must not race: two devices finishing at the same moment
-- should add two, not overwrite each other. The upsert does that atomically.
create or replace function bump_player_games(p_user uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into player_game_counts (user_id, games, updated_at)
  values (p_user, 1, now())
  on conflict (user_id) do update
    set games = player_game_counts.games + 1, updated_at = now()
  returning games;
$$;

-- Service role only: this is called from a server route that has already
-- authenticated the caller, and nothing client-side should be able to inflate
-- its own play count. EXECUTE is granted to PUBLIC by default, so the revoke
-- has to name public, not anon/authenticated.
revoke execute on function bump_player_games(uuid) from public;
grant execute on function bump_player_games(uuid) to service_role;
