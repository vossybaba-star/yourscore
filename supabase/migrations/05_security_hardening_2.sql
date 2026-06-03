-- 05_security_hardening_2.sql
-- Follow-up to 03: reliable room_members PII fix + set the admin account.

begin;

-- ===========================================================================
-- H4 (reliable) — The column-level revoke of room_members.whatsapp_number in
-- migration 03 could not fully take effect (the column was granted by multiple
-- grantors). The client never reads room_members cross-user (only /admin server
-- code does, via the service role which bypasses RLS), so restrict the SELECT
-- policy to the owning user. Other users' rows — and their phone numbers — are
-- then unreachable through the public anon key.
-- ===========================================================================
drop policy if exists "Room members readable" on room_members;
create policy "Members read own membership" on room_members
  for select using (auth.uid() = user_id);

commit;

-- ===========================================================================
-- Set the admin account. No user currently has the is_admin flag in either
-- metadata bag, so admin (app + RLS, now keyed on app_metadata) would be
-- inaccessible. Grant it to the owner account in app_metadata (service-role-only,
-- not user-editable). Idempotent.
-- ===========================================================================
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where email = 'vossybaba@gmail.com';
