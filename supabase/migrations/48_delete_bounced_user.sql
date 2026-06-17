-- 48_delete_bounced_user.sql
-- Adds delete_bounced_user(email) — a wrapper around delete_user_account(uuid)
-- that resolves the auth user from an email address. Called by the Resend webhook
-- on email.bounced / email.complained events so the auth identity + all public
-- schema data is removed atomically. The webhook then calls auth.admin.deleteUser
-- to drop the auth.users row (which delete_user_account already unblocks).
--
-- Security: service_role only, same as delete_user_account.

begin;

create or replace function delete_bounced_user(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
    from auth.users
   where email = lower(trim(p_email))
   limit 1;

  if v_user_id is null then
    return null;
  end if;

  perform delete_user_account(v_user_id);
  return v_user_id;
end;
$$;

revoke all on function delete_bounced_user(text) from public;
revoke all on function delete_bounced_user(text) from anon;
revoke all on function delete_bounced_user(text) from authenticated;
grant execute on function delete_bounced_user(text) to service_role;

commit;
