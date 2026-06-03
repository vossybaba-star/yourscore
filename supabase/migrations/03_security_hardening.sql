-- 03_security_hardening.sql
-- Pre-App-Store security hardening. Written against the LIVE database schema
-- (introspected via pg_policies), which differs from the stale schema.sql.
-- Apply with `supabase db push`. Idempotent: drop-if-exists guards throughout.

begin;

-- ===========================================================================
-- C2 — Admin authorization must read app_metadata (raw_app_meta_data), which is
-- settable ONLY by the service role. raw_user_meta_data is user-editable via
-- supabase.auth.updateUser({ data: { is_admin: true } }) → self-promotion.
-- The only is_admin RLS policy in the live DB is on `matches`.
-- (App-layer checks updated in src/lib/auth/admin.ts + src/lib/supabase/middleware.ts.)
-- ===========================================================================
drop policy if exists "Matches managed by admins" on matches;
create policy "Matches managed by admins" on matches
  for all using (
    exists (
      select 1 from auth.users
      where id = auth.uid()
      and raw_app_meta_data->>'is_admin' = 'true'
    )
  );

-- ===========================================================================
-- H2 — room_scores was world-writable: "System updates room scores" was
-- `for all using (true)`, letting any anon-key holder set their score to 999999
-- or wipe others. Legit writes happen via the service-role client (bypasses
-- RLS). Drop it; keep the public SELECT policy.
-- ===========================================================================
drop policy if exists "System updates room scores" on room_scores;

-- ===========================================================================
-- H3 — rooms was world-updatable: "Admins update rooms" was `for update
-- using (true)`. Drop it. Recreate the creator-scoped update WITH CHECK so a
-- creator cannot reassign ownership either.
-- ===========================================================================
drop policy if exists "Admins update rooms" on rooms;
drop policy if exists "Room creator can update" on rooms;
create policy "Room creator can update" on rooms
  for update using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- ===========================================================================
-- (Discovered during audit) match_scores was self-writable: "match_scores_write"
-- was `for all using (auth.uid() = user_id)`, letting any user INSERT/UPDATE
-- their OWN leaderboard row to an arbitrary score. The client only READS
-- match_scores (match/[id]/page.tsx); the score is written by /api/answer via
-- the service-role client. Drop the client write policy; keep public SELECT.
-- ===========================================================================
drop policy if exists "match_scores_write" on match_scores;

-- ===========================================================================
-- H4 — room_members.whatsapp_number (phone numbers / PII) was readable by the
-- public anon key ("Room members readable" using(true) + a column SELECT grant
-- that included whatsapp_number). The column is only read server-side (admin/fire
-- via the service role). Use column-level privileges so anon/authenticated lose
-- access to the phone column but keep the rest. service_role keeps full access.
-- ===========================================================================
revoke select on room_members from anon, authenticated;
grant select (id, room_id, user_id, joined_at, notification_consent, last_seen_at)
  on room_members to anon, authenticated;

commit;

-- ===========================================================================
-- Preserve admin access: copy is_admin from the (now distrusted) user_metadata
-- into app_metadata so the current admin isn't locked out when the matches
-- policy + app checks switch to raw_app_meta_data. Pre-launch this affects only
-- the legitimate admin — verify below and revoke anything you don't recognise.
-- ===========================================================================
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where raw_user_meta_data->>'is_admin' = 'true';

-- Verify after applying:
--   select email, raw_app_meta_data->>'is_admin' as is_admin
--   from auth.users where raw_app_meta_data->>'is_admin' = 'true';
