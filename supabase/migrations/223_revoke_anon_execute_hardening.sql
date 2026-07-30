-- 223_revoke_anon_execute_hardening.sql
-- Security audit 2026-07-30. Closes anon-callable privileged functions + restores
-- the SECURITY INVOKER setting on views that regressed.
--
-- WHY THESE ARE SAFE TO REVOKE (verified before writing this):
--   * All four functions are owned by `postgres`; an owner always retains EXECUTE
--     regardless of grants.
--   * `fantasy_collect_tick` is invoked by the pg_cron job `fantasy-collect`,
--     which runs as `postgres` — unaffected.
--   * `bump_player_games` is called from exactly one place — the server route
--     src/app/api/review-prompt/route.ts — via createServiceClient() (service_role),
--     which keeps its explicit grant below.
--   * The other two are TRIGGER functions (they return `trigger` and are attached to
--     3 triggers). Trigger execution does not consult EXECUTE privilege, so revoking
--     only removes their bogus /rest/v1/rpc surface.
--
-- NOTE: Postgres grants function EXECUTE to the implicit PUBLIC role by default,
-- which anon/authenticated inherit. `revoke ... from anon, authenticated` alone is a
-- NO-OP — PUBLIC must be named. (Migration 105 already tried to lock down
-- bump_player_games; the grant was back in effect on prod, so this re-asserts it.)

-- 1) fantasy_collect_tick — was the worst of these: SECURITY DEFINER, reads a vault
--    secret and fires the privileged `fantasy-collect` Edge Function. Anyone holding
--    the public anon key could trigger the job at will.
revoke execute on function public.fantasy_collect_tick()                    from public, anon, authenticated;

-- 2) bump_player_games — anon could inflate ANY user's game counter (drives the
--    App Store review-prompt pacing and player stats).
revoke execute on function public.bump_player_games(uuid)                   from public, anon, authenticated;
grant  execute on function public.bump_player_games(uuid)                   to service_role;

-- 3) Trigger functions never belong on the RPC surface.
revoke execute on function public.club_supporters_validate_club()           from public, anon, authenticated;
revoke execute on function public.comments_validate_reply()                 from public, anon, authenticated;

-- 4) SECURITY DEFINER views → security_invoker, so they respect the caller's RLS.
--    `yourscore_user_ratings` was set to security_invoker in a previous audit and
--    REGRESSED: a later migration recreated the view, silently dropping the setting.
--    Set it here AND keep this setting attached to any future recreate of the view.
alter view public.yourscore_user_ratings         set (security_invoker = on);
alter view public.fantasy_captain_rehearsal      set (security_invoker = on);
alter view public.fantasy_captain_exclusions     set (security_invoker = on);
alter view public.fantasy_captain_shadow_summary set (security_invoker = on);
