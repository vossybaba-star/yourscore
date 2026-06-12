-- 36_draft_live_cross_competition.sql
-- 38-0 Live H2H — cross-competition matchmaking.
--
-- A live match is just 11 rated players a side, so a La Liga XI and a Premier
-- League XI are a perfectly valid fixture. This lets the random queue pair players
-- regardless of which competition's team they bring, while each player's result
-- still credits THEIR OWN competition's leaderboard (an honest La Liga win must not
-- land on the PL board).
--
-- To credit correctly we record the competition each SIDE brought:
--   p1_competition / p2_competition  — the team's competition, per side.
-- The existing single `competition` column stays as the lobby/context competition
-- (used for OG copy + friend/league lobbies, which remain same-competition).
--
-- ADDITIVE + idempotent. New columns default to 'PL' and are backfilled from the
-- existing per-match `competition`, so every in-flight and historical row is
-- unchanged. Server stays authoritative: the competition is taken from the saved
-- team / queue row, never trusted blind from the client.

begin;

-- 1. Per-side competition on the live working-state row ---------------------------
alter table draft_live_matches add column if not exists p1_competition text not null default 'PL';
alter table draft_live_matches add column if not exists p2_competition text not null default 'PL';

-- Backfill: existing matches were always single-competition, so both sides match the
-- row's competition. (Cheap one-time pass; new rows set these explicitly on insert.)
update draft_live_matches
   set p1_competition = competition,
       p2_competition = competition
 where p1_competition = 'PL' and p2_competition = 'PL' and competition <> 'PL';

-- 2. Cross-competition pairing -----------------------------------------------------
-- Pairs with the oldest compatible waiter regardless of the competition they queued
-- with (a La Liga XI can face a PL XI). Still scoped to the same ranked flag and
-- league bracket (the public queue is league_id = null; competition-specific league
-- queues aren't used for random play). Returns the opponent AND the competition they
-- queued with, so the caller can load the right XI and stamp p1_competition.
drop function if exists draft_live_pair(uuid, boolean, uuid, text);
create or replace function draft_live_pair(
  p_user uuid,
  p_ranked boolean,
  p_league uuid,
  p_competition text default 'PL'
)
returns table (opp_user uuid, opp_competition text)
language plpgsql
security definer
as $$
declare
  v_match uuid;
  v_opp_comp text;
  v_comp text := coalesce(p_competition, 'PL');
begin
  select user_id, competition into v_match, v_opp_comp
    from draft_live_queue
   where user_id <> p_user
     and ranked = p_ranked
     and league_id is not distinct from p_league
   order by enqueued_at
   for update skip locked
   limit 1;

  if v_match is not null then
    delete from draft_live_queue where user_id in (v_match, p_user);
    opp_user := v_match;
    opp_competition := v_opp_comp;
    return next;
    return;
  end if;

  -- Nobody waiting — enqueue self (carrying our competition) and report empty.
  insert into draft_live_queue (user_id, ranked, league_id, competition)
  values (p_user, p_ranked, p_league, v_comp)
  on conflict (user_id) do update
    set enqueued_at = now(), ranked = excluded.ranked, league_id = excluded.league_id, competition = excluded.competition;
  return;
end;
$$;

commit;
