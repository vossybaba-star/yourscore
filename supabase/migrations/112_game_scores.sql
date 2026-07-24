-- 112 — Higher or Lower and Guess the Player finally keep a score.
--
-- Until now these two games persisted nothing at all: /api/games/[type] served
-- a round and graded single answers, and the finished run evaporated. That is
-- why the results screen told every player "Practice mode: these don't count on
-- the leaderboard yet" — it was accurate. It also meant the guest sign-up ask
-- had nothing behind it: creating an account did not bank the score you just
-- posted, because there was nowhere to put it.
--
-- game_runs (2 rows, 20 Jul, no score column, written by nothing in the current
-- code) was an earlier start on this. It is left alone — migration 103 reads it
-- as a seed source for play counts — but it is not what this builds on.
--
-- Rows are written ONLY by the server, from a re-graded run: the client posts
-- the seed plus its answers, the route rebuilds the same round from that seed
-- and re-scores every answer itself. A client cannot post a score.

create table if not exists game_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  game text not null,
  -- Higher or Lower rounds can be scoped to a topic (goals, assists, age...).
  -- Kept so a per-topic board is possible later without a backfill.
  topic text not null default 'mixed',
  seed text not null,
  score integer not null,
  max_score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  fastest_ms integer,
  created_at timestamptz not null default now(),
  constraint game_scores_game_check check (game in ('higher-lower', 'guess-the-player')),
  constraint game_scores_score_sane check (score >= 0 and score <= max_score),
  -- One banked run per seed per player. A round is derived from its seed, so
  -- replaying the same seed is the same round — without this, a player could
  -- bank the same good run repeatedly, and a guest claim that fires twice
  -- (double tap, retried request) would double-count.
  constraint game_scores_seed_once unique (user_id, seed)
);

-- The board: best score per game, newest first as the tie-break.
create index if not exists game_scores_board_idx on game_scores (game, score desc, created_at);
-- A player's own best in a game, for "beat your best" on the intro screen.
create index if not exists game_scores_user_idx on game_scores (user_id, game, score desc);

alter table game_scores enable row level security;
-- No policies, by design: service role only. The board is read through a server
-- route that joins usernames, so nothing client-side needs direct select, and
-- direct select would expose user_id to anyone.

-- Rank against BEST-per-player, not against every row. Ranking raw rows would
-- put one player who has played forty times all over the top of the board.
-- Returns the position this score would take, so it answers both "where did I
-- land" (signed in, after the insert) and "where would I land" (a guest being
-- shown what an account is worth) with the same query.
create or replace function game_rank(p_game text, p_score integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 1 + count(*)::int
  from (
    select user_id, max(score) as best
    from game_scores
    where game = p_game
    group by user_id
  ) t
  where t.best > p_score;
$$;

-- EXECUTE is granted to PUBLIC by default, so the revoke has to name public.
revoke execute on function game_rank(text, integer) from public;
grant execute on function game_rank(text, integer) to service_role;
