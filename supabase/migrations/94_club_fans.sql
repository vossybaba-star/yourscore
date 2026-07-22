-- Club-Fan Leaderboard — the data layer.
--
-- Fan groups (Arsenal fans vs Spurs fans vs Brentford fans, ...) compete against
-- each other at the end of every gameweek, ranked by AVERAGE halftime-quiz-pack
-- score per participating fan (never a raw total — see src/lib/clubs/table.ts for
-- why, that rule is enforced there, not here).
--
-- ADDITIVE ONLY. One new table: club_supporters — who supports which club. That is
-- the entire write surface; the leaderboard itself is computed on read from
-- quiz_attempts + halftime_releases every time (never materialised, so it can
-- never go stale — see the fantasy-work precedent this follows).
--
-- LOCKED DECISION #2: a user picks their club once and it is LOCKED FOR THE SEASON.
-- Enforced structurally, not just in the API:
--   * PRIMARY KEY (user_id, season_id) — one declaration per user per season.
--   * NO update policy and NO delete policy for anon/authenticated. That absence IS
--     the lock: a client holding a valid session cannot change or remove the club it
--     declared, so nobody can hop to whoever is winning mid-season.
-- A NEW season is a new row, so a genuine change of heart is possible between
-- seasons but never within one. (A PK on user_id alone would have locked a fan to
-- one club forever, which is NOT what "locked for the season" means.)
--
-- LOCKED DECISION #3: the club list is NOT hardcoded. Valid clubs for a season are
-- whatever distinct home/away teams appear in halftime_releases for that season_id
-- — self-maintaining across promotion/relegation. A validation trigger (below)
-- enforces this at the DB layer too, not just in the API route.

begin;

-- 1. Who supports which club ---------------------------------------------------

create table if not exists club_supporters (
  user_id    uuid not null references profiles(id) on delete cascade,
  club       text not null,
  season_id  bigint not null,
  created_at timestamptz not null default now(),

  -- One club per user PER SEASON. Within a season the row cannot be changed (no
  -- update/delete policy, §3) — that is the lock. A new season is a new row.
  primary key (user_id, season_id)
);

create index if not exists club_supporters_club_season_idx
  on club_supporters (season_id, club);

-- 2. Club-validity guard, enforced in the DB -------------------------------------
-- A club can only be declared if it is actually a home/away team in
-- halftime_releases for that season. SECURITY DEFINER so the check works
-- regardless of caller: halftime_releases is deny-all RLS for anon/authenticated
-- (migration 80), so an INVOKER-rights version of this trigger would fail to even
-- read the table when a client inserts directly under the "insert own row" policy
-- below. The function owner (the migrating role) owns halftime_releases too and
-- is not subject to its own RLS, so this reads fine without any extra grant.

create or replace function club_supporters_validate_club()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean;
begin
  select exists (
    select 1 from public.halftime_releases hr
    where hr.season_id = new.season_id
      and (hr.home = new.club or hr.away = new.club)
  ) into v_valid;

  if not v_valid then
    raise exception 'club "%" is not a valid club for season %', new.club, new.season_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Default EXECUTE on a new function is granted to PUBLIC — revoke it (the
-- halftime_touch_updated_at precedent, migration 80). Trigger firing does not
-- depend on this grant; this only closes off direct SELECT-function-style calls.
revoke all on function club_supporters_validate_club() from public;

drop trigger if exists club_supporters_validate_club_trg on club_supporters;
create trigger club_supporters_validate_club_trg
  before insert on club_supporters
  for each row execute function club_supporters_validate_club();

-- 3. RLS --------------------------------------------------------------------
-- A user may read and create their own row. No update policy, no delete policy —
-- that absence IS the lock: RLS denies both operations outright for
-- anon/authenticated once enabled, regardless of ownership. service_role has
-- BYPASSRLS and keeps its default table grants, so the API routes (which read
-- every user's row for the gameweek table) are unaffected.

alter table club_supporters enable row level security;

create policy "Users select own club" on club_supporters
  for select using (auth.uid() = user_id);

create policy "Users insert own club" on club_supporters
  for insert with check (auth.uid() = user_id);

commit;
