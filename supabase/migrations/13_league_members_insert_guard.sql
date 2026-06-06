-- 13_league_members_insert_guard.sql
--
-- SECURITY — pin league_members stat columns to 0 on INSERT.
--
-- Members are inserted client-side via the anon key when a user creates/joins a
-- league. The insert RLS policy (league_members_insert) only checks
-- user_id = auth.uid(), NOT the column values, so a crafted insert could seed an
-- arbitrary total_score / best_streak and start a league pre-loaded with points.
--
-- A BEFORE INSERT trigger is the most robust fix: regardless of what the client
-- sends, every new membership starts at zero. Legitimate progress is added later
-- by update_league_member_stats(). This needs no client-code change.
create or replace function sanitize_league_member_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.total_score         := 0;
  new.games_played        := 0;
  new.questions_attempted := 0;
  new.questions_correct   := 0;
  new.current_streak      := 0;
  new.best_streak         := 0;
  return new;
end;
$$;

drop trigger if exists trg_sanitize_league_member_insert on league_members;
create trigger trg_sanitize_league_member_insert
  before insert on league_members
  for each row
  execute function sanitize_league_member_insert();
