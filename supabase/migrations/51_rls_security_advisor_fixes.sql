-- 43_rls_security_advisor_fixes.sql
-- Resolves the Supabase Security Advisor ERROR-level findings (2026-06-17).
--
-- 1) admin_chat_messages, spend_logs, health_logs had RLS DISABLED while the
--    public `anon` and `authenticated` roles held full SELECT/INSERT/UPDATE/
--    DELETE/TRUNCATE grants. Because the anon key ships in the client bundle,
--    anyone could read admin chat and read/truncate the internal log tables
--    straight through PostgREST. These tables are service-role-only: no app
--    code, DB function, or trigger references them, and none are in the
--    realtime publication. The external writers use the service-role key,
--    which bypasses RLS entirely and does not depend on the role grants below.
--    Fix = enable RLS (no policy => deny-all for anon/authenticated) AND
--    revoke the leftover public grants (defence in depth).
--
-- 2) The yourscore_user_ratings view ran with SECURITY DEFINER semantics
--    (owned by postgres), bypassing RLS on its underlying tables. It only
--    surfaces leaderboard-public columns (display name, avatar, scores, W/D/L)
--    and is consumed via SECURITY DEFINER leaderboard RPCs (which run as the
--    definer regardless), so switching it to security_invoker clears the
--    advisor error without changing behaviour.
--
-- All statements are idempotent / safe to re-run.

-- 1) Lock down the three internal tables -----------------------------------
alter table public.admin_chat_messages enable row level security;
alter table public.spend_logs          enable row level security;
alter table public.health_logs         enable row level security;

revoke all on table public.admin_chat_messages from anon, authenticated;
revoke all on table public.spend_logs          from anon, authenticated;
revoke all on table public.health_logs         from anon, authenticated;

-- 2) Make the ratings view respect the caller's RLS ------------------------
alter view public.yourscore_user_ratings set (security_invoker = on);
