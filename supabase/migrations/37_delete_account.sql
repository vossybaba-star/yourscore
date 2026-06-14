-- 37_delete_account.sql
-- Full account deletion — the data-side of "delete every bit of a user's record".
--
-- delete_user_account(p_user) erases ALL of a user's rows across the public schema,
-- then the caller (the /api/account/delete route, service role) removes the auth
-- identity via the GoTrue admin API, whose auth.users cascade clears `profiles`
-- (and anything this function missed that cascades).
--
-- Why a function and not "just delete the auth user": profiles.id itself references
-- auth.users with NO ACTION (there is NO auth→profiles cascade), and several tables
-- reference profiles(id) with NO cascade (answers, room_members, room_scores, rooms)
-- plus two club tables reference auth.users with ON DELETE RESTRICT — so a bare auth
-- delete would FAIL. This clears every blocker in FK-safe order, then removes the
-- profile, so the final admin deleteUser only has to drop the auth identity.
--
-- Content that is shared / not personal is DE-LINKED, not destroyed: a user's custom
-- quiz packs, the lobbies and leagues they created stay alive for everyone else, with
-- the personal ownership link nulled (the GDPR-correct outcome).
--
-- SECURITY DEFINER so it runs as the table owner (bypasses RLS). Execution is granted
-- ONLY to service_role — never anon/authenticated — and the route always passes the
-- caller's OWN id from their authenticated session, so no one can delete another
-- account. Every statement is guarded with to_regclass so it no-ops on tables that
-- a given environment hasn't migrated in yet.

begin;

create or replace function delete_user_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ── Club leagues (migration 36) — owner_id / created_by are ON DELETE RESTRICT,
  --    so these MUST be cleared before the auth user can be removed.
  if to_regclass('public.club_leagues') is not null then
    -- Leagues this user owns: deleting the league cascades its events/members/attempts.
    delete from club_leagues where owner_id = p_user;
  end if;
  if to_regclass('public.club_league_events') is not null then
    delete from club_league_events where created_by = p_user; -- events in others' leagues
  end if;
  if to_regclass('public.club_event_attempts') is not null then
    delete from club_event_attempts where user_id = p_user;
  end if;
  if to_regclass('public.club_league_members') is not null then
    delete from club_league_members where user_id = p_user;
  end if;

  -- ── Quiz core: tables referencing profiles(id) with NO cascade (would block the
  --    profiles delete) + the user's own quiz data.
  if to_regclass('public.answers') is not null then
    delete from answers where user_id = p_user;
  end if;
  if to_regclass('public.room_scores') is not null then
    delete from room_scores where user_id = p_user;
  end if;
  if to_regclass('public.room_members') is not null then
    delete from room_members where user_id = p_user;
  end if;
  if to_regclass('public.challenge_attempts') is not null then
    delete from challenge_attempts where user_id = p_user;
  end if;
  if to_regclass('public.quiz_attempts') is not null then
    delete from quiz_attempts where user_id = p_user;
  end if;
  if to_regclass('public.user_question_history') is not null then
    delete from user_question_history where user_id = p_user;
  end if;
  if to_regclass('public.match_scores') is not null then
    delete from match_scores where user_id = p_user;
  end if;
  if to_regclass('public.match_interests') is not null then
    delete from match_interests where user_id = p_user;
  end if;
  if to_regclass('public.match_notifications') is not null then
    delete from match_notifications where user_id = p_user;
  end if;
  if to_regclass('public.h2h_challenges') is not null then
    delete from h2h_challenges where challenger_id = p_user or opponent_id = p_user;
  end if;

  -- ── Social / device.
  if to_regclass('public.friendships') is not null then
    delete from friendships where user_id = p_user or friend_id = p_user;
  end if;
  if to_regclass('public.device_tokens') is not null then
    delete from device_tokens where user_id = p_user;
  end if;
  if to_regclass('public.league_members') is not null then
    delete from league_members where user_id = p_user;
  end if;

  -- ── 38-0 (draft) data.
  if to_regclass('public.draft_live_queue') is not null then
    delete from draft_live_queue where user_id = p_user;
  end if;
  if to_regclass('public.draft_live_matches') is not null then
    -- A match where they were only the (unaccepted) invitee: drop the dangling link.
    update draft_live_matches set invited_id = null where invited_id = p_user;
    delete from draft_live_matches where p1_id = p_user or p2_id = p_user;
  end if;
  if to_regclass('public.draft_matches') is not null then
    delete from draft_matches where challenger_id = p_user or opponent_id = p_user;
  end if;
  if to_regclass('public.draft_challenges') is not null then
    delete from draft_challenges where challenger_id = p_user;
  end if;
  if to_regclass('public.draft_league_members') is not null then
    delete from draft_league_members where user_id = p_user;
  end if;
  if to_regclass('public.draft_leagues') is not null then
    delete from draft_leagues where owner_id = p_user; -- cascades its members
  end if;
  if to_regclass('public.draft_standings') is not null then
    delete from draft_standings where user_id = p_user;
  end if;
  if to_regclass('public.draft_teams') is not null then
    delete from draft_teams where user_id = p_user;
  end if;
  if to_regclass('public.draft_saved_teams') is not null then
    delete from draft_saved_teams where user_id = p_user;
  end if;
  if to_regclass('public.draft_season_records') is not null then
    delete from draft_season_records where user_id = p_user;
  end if;
  if to_regclass('public.draft_wc_runs') is not null then
    delete from draft_wc_runs where user_id = p_user; -- cascades draft_wc_matches
  end if;

  -- ── Shared content the user authored: keep it, sever the personal link.
  if to_regclass('public.quiz_packs') is not null then
    update quiz_packs set user_id = null, created_by = null
      where user_id = p_user or created_by = p_user;
  end if;
  if to_regclass('public.rooms') is not null then
    update rooms set created_by = null where created_by = p_user;
  end if;
  if to_regclass('public.leagues') is not null then
    update leagues set created_by = null where created_by = p_user;
  end if;

  -- Lifecycle email log (holds their email address).
  if to_regclass('public.email_log') is not null then
    delete from email_log where user_id = p_user;
  end if;

  -- Finally the profile itself. profiles.id is NO ACTION from auth.users (no cascade),
  -- so it MUST be deleted here for the auth.users delete to succeed; its remaining
  -- children (challenge_attempts, quiz_attempts) are ON DELETE CASCADE and go with it.
  if to_regclass('public.profiles') is not null then
    delete from profiles where id = p_user;
  end if;
end;
$$;

-- Backend-only. A logged-in user must never be able to invoke this against any id.
revoke all on function delete_user_account(uuid) from public;
revoke all on function delete_user_account(uuid) from anon;
revoke all on function delete_user_account(uuid) from authenticated;
grant execute on function delete_user_account(uuid) to service_role;

commit;
