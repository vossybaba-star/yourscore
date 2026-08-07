-- 263_league_profile.sql — league "community" identity: a short bio and social
-- links, so a league (especially a public one in Discover) reads as a real
-- community with showmanship, not just a name in a list. Caps/shape are
-- enforced app-side (src/lib/fantasy/leagues.ts): bio ~200 chars; links is
-- { discord?, x?, instagram?, tiktok?, website? }, each an https URL, max 5
-- keys, discord restricted to discord.gg/discord.com.
--
-- No RLS change needed: fantasy_leagues already has member/public SELECT
-- (203_fantasy_leagues.sql) and deny-all writes for anon/authenticated
-- (service role only, same migration) — bio/links ride the same policies as
-- every other column on this table. Writes go through the owner-gated PATCH
-- at /api/fantasy/leagues/[code] (requireOwnerLeague → setLeagueProfile,
-- src/lib/fantasy/leagues.ts) — never a direct client write.
begin;

alter table public.fantasy_leagues add column if not exists bio text;
alter table public.fantasy_leagues add column if not exists links jsonb not null default '{}'::jsonb;

commit;
