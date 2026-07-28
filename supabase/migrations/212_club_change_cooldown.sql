-- Club change: a 30-day cooldown replaces the season-long lock (founder, 2026-07-27).
--
-- SUPERSEDES locked decision #2 of migration 94. A supporter was previously
-- immovable for the whole season (PK (user_id, season_id) + no update policy).
-- Now they may change club, but at most ONCE EVERY 30 DAYS. The initial
-- declaration starts the first 30-day window, so a fresh pick is also locked for
-- 30 days — that is the warning the UI shows before the first save.
--
-- The anti-gaming intent survives in a softer form: a fan still cannot hop to
-- whoever is winning on a whim, only once a month. That is a product call the
-- founder has made with eyes open; the cooldown is the new guard.
--
-- Enforcement stays structural, not just in the API (the migration-94 pattern):
--   * changed_at stamps the last club change; the cooldown is measured from it.
--   * A BEFORE UPDATE cooldown trigger rejects a change inside the window and
--     re-stamps changed_at on a real change — so even a direct/service-role write
--     that skips the API cannot beat the clock (triggers fire regardless of role;
--     BYPASSRLS does not bypass triggers).
--   * The club-validity trigger (migration 94) is extended to UPDATE too, so a
--     changed-to club must still be a real club for the season.
-- There is still NO update/delete RLS policy for anon/authenticated: clients
-- cannot self-update. Only the audited /api/clubs/me route (service_role) writes,
-- and it is subject to the cooldown trigger like everyone else.

begin;

-- 1. When the club was last set/changed — the cooldown is measured from here.
--    Existing rows default to now(): every current supporter starts a fresh
--    30-day window at migration time rather than being instantly changeable.
alter table club_supporters
  add column if not exists changed_at timestamptz not null default now();

-- 2. Validity on UPDATE too (INSERT is already guarded by migration 94's trigger).
--    Reuses club_supporters_validate_club(): it checks NEW.club against
--    halftime_releases for the season and is SECURITY DEFINER, so it reads that
--    deny-all-RLS table fine. Fires only when the club actually changes.
drop trigger if exists club_supporters_validate_club_upd_trg on club_supporters;
create trigger club_supporters_validate_club_upd_trg
  before update on club_supporters
  for each row
  when (new.club is distinct from old.club)
  execute function club_supporters_validate_club();

-- 3. The cooldown guard. A real club change is allowed only once every 30 days,
--    and stamps changed_at. A no-op update (same club) never trips the cooldown
--    nor resets the clock. Not SECURITY DEFINER — it reads no other table.
create or replace function club_supporters_enforce_cooldown()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.club is distinct from old.club then
    if now() - old.changed_at < interval '30 days' then
      raise exception 'club change is on cooldown until %',
        old.changed_at + interval '30 days'
        using errcode = '23514';
    end if;
    new.changed_at := now();
  end if;
  return new;
end;
$$;

-- Default EXECUTE goes to PUBLIC; revoke it (the migration-94 hygiene pattern).
-- Trigger firing does not depend on this grant.
revoke all on function club_supporters_enforce_cooldown() from public;

drop trigger if exists club_supporters_enforce_cooldown_trg on club_supporters;
create trigger club_supporters_enforce_cooldown_trg
  before update on club_supporters
  for each row execute function club_supporters_enforce_cooldown();

commit;
