-- 44_security_advisor_hardening.sql
-- Clears the remaining Supabase Security Advisor WARN findings (2026-06-17),
-- following the ERROR fixes in migration 43.
--
-- PART A — Privilege escalation: SECURITY DEFINER functions the public `anon`
-- key could call directly via /rest/v1/rpc. These are all invoked SERVER-SIDE
-- ONLY through the service-role client (verified in code), and service_role
-- keeps its own EXECUTE grant, so revoking anon/authenticated is safe:
--   * increment_profile_score    -> a client could award itself unlimited
--                                   points and climb the prize leaderboard
--   * update_league_member_stats -> rig private-league standings
--   * apply_timeout_penalty      -> penalise arbitrary opponents
--   * draft_live_pair            -> tamper with matchmaking
--   * increment_question_stats   -> dead (replaced by record_quiz_results)
--   * handle_new_user            -> auth.users trigger; never an RPC
--   * sanitize_league_member_insert -> table trigger; never an RPC
--
-- NOTE: Postgres grants function EXECUTE to the implicit PUBLIC role by
-- default, which anon/authenticated inherit. Revoking from the named roles
-- alone is a no-op — we must revoke from PUBLIC. service_role holds its own
-- explicit grant (verified), but we re-grant it for clarity/safety.
revoke execute on function public.increment_profile_score(uuid, integer)              from public, anon, authenticated;
revoke execute on function public.update_league_member_stats(uuid, integer, boolean)  from public, anon, authenticated;
revoke execute on function public.apply_timeout_penalty(uuid, uuid[], integer)        from public, anon, authenticated;
revoke execute on function public.draft_live_pair(uuid, boolean, uuid, text)          from public, anon, authenticated;
revoke execute on function public.increment_question_stats(uuid[], uuid[])            from public, anon, authenticated;
revoke execute on function public.handle_new_user()                                   from public, anon, authenticated;
revoke execute on function public.sanitize_league_member_insert()                     from public, anon, authenticated;

grant execute on function public.increment_profile_score(uuid, integer)              to service_role;
grant execute on function public.update_league_member_stats(uuid, integer, boolean)  to service_role;
grant execute on function public.apply_timeout_penalty(uuid, uuid[], integer)        to service_role;
grant execute on function public.draft_live_pair(uuid, boolean, uuid, text)          to service_role;
grant execute on function public.increment_question_stats(uuid[], uuid[])            to service_role;
grant execute on function public.handle_new_user()                                   to service_role;
grant execute on function public.sanitize_league_member_insert()                     to service_role;

-- PART B — Pin a non-mutable search_path on the flagged functions (matches the
-- existing `search_path=public` convention already used by the hardened
-- functions in this DB). Verified none of these reference extension-schema
-- functions, so `public` (with pg_catalog always implicit) is sufficient and
-- non-breaking. Closes the search_path-hijack vector on the SECURITY DEFINER
-- ones in particular.
alter function public.increment_profile_score(uuid, integer)              set search_path = public;
alter function public.update_league_member_stats(uuid, integer, boolean)  set search_path = public;
alter function public.increment_question_stats(uuid[], uuid[])            set search_path = public;
alter function public.draft_live_pair(uuid, boolean, uuid, text)          set search_path = public;
alter function public.draft_live_reap()                                   set search_path = public;
alter function public.set_quiz_packs_updated_at()                         set search_path = public;
alter function public.check_rate_limit(text, integer, integer)            set search_path = public;
alter function public.get_my_leagues(uuid)                                set search_path = public;
alter function public.get_my_league_standings(uuid, integer)             set search_path = public;
alter function public.draft_reset_daily()                                 set search_path = public;
alter function public.draft_leaderboard(uuid, text, integer)             set search_path = public;
alter function public.draft_credit_result(uuid, text, text, uuid, text)  set search_path = public;
alter function public.draft_leaderboard_points(uuid, text, integer, text) set search_path = public;
