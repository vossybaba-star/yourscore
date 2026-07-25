-- 113 — the board itself for Higher or Lower and Guess the Player.
--
-- 112 gave these games somewhere to keep a score and a rank function to say
-- where one lands. This is the readable board that goes with it.
--
-- One row per player, not per run: their BEST. A per-run board would be a list
-- of the same few names, and it would quietly reward volume over knowledge,
-- which is the opposite of what the score is supposed to mean.
--
-- Ties break on who got there first, so a score that has stood all week is not
-- pushed down by someone matching it today.
--
-- security definer because game_scores is service-role only (no RLS policies):
-- nothing client-side can read the table directly, and this is the one shape
-- that is safe to expose, joined to public profile fields.

create or replace function game_board(p_game text, p_limit integer default 25)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  best integer,
  plays bigint,
  best_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with bests as (
    select distinct on (s.user_id)
      s.user_id,
      s.score as best,
      s.created_at as best_at
    from game_scores s
    where s.game = p_game
    order by s.user_id, s.score desc, s.created_at asc
  ),
  counts as (
    select s.user_id, count(*) as plays
    from game_scores s
    where s.game = p_game
    group by s.user_id
  )
  select b.user_id, p.username, p.avatar_url, b.best, c.plays, b.best_at
  from bests b
  join counts c on c.user_id = b.user_id
  join profiles p on p.id = b.user_id
  order by b.best desc, b.best_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke execute on function game_board(text, integer) from public;
grant execute on function game_board(text, integer) to service_role;

-- A single player's standing, so the board can pin "you" without pulling the
-- whole table down to the client when they sit outside the visible top slice.
create or replace function game_my_standing(p_game text, p_user uuid)
returns table (best integer, plays bigint, rank integer)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select max(score) as best, count(*) as plays
    from game_scores
    where game = p_game and user_id = p_user
  )
  select
    mine.best,
    mine.plays,
    case when mine.best is null then null else game_rank(p_game, mine.best) end
  from mine;
$$;

revoke execute on function game_my_standing(text, uuid) from public;
grant execute on function game_my_standing(text, uuid) to service_role;
