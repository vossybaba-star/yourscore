-- 53_neuter_delete_bounced_user.sql
-- SECURITY MITIGATION (2026-06-18, applied to prod via Management API).
--
-- Context: /api/webhooks/resend was fail-open in production (RESEND_WEBHOOK_SECRET
-- was not set), so an unauthenticated POST of a forged `email.bounced` /
-- `email.complained` event would resolve a user by the email in the payload and
-- permanently delete that account (delete_bounced_user -> delete_user_account ->
-- auth.admin.deleteUser). This was a live, remote, unauthenticated mass-deletion
-- vector — confirmed exploitable by probe.
--
-- delete_bounced_user is the chokepoint the webhook relied on, so it is neutered
-- to a no-op here as an immediate, deploy-free kill switch. The webhook route has
-- separately been rewritten to (a) FAIL CLOSED when the secret is missing and
-- (b) be SUPPRESS-ONLY (it no longer deletes accounts at all). Account deletion
-- now lives solely in the authenticated self-serve flow (delete_user_account,
-- gated by the signed-in user).
--
-- This function is intentionally left as a no-op: the rewritten webhook never
-- calls it, and an email-keyed account-deletion primitive is dangerous to keep
-- live. Original behaviour (for reference): looked up auth.users by email and
-- called delete_user_account(id).

create or replace function public.delete_bounced_user(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- Neutered: never delete from a webhook. Returns null so callers no-op.
  return null;
end
$fn$;
