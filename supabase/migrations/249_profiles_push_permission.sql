-- Record what the OS actually says about push, per profile.
--
-- Until now `notifications_opt_in = false` covered two completely different
-- people: someone who has never been asked and can still be shown Apple's
-- permission dialog, and someone who already refused it and never can be again.
-- They look identical from the server, so there was no way to tell whether to
-- push harder on our own prompt or route people to iOS Settings.
--
-- Written by the app on every open (src/components/native/PushPrePrompt.tsx),
-- which is the only place that can see it — the permission state lives on the
-- device, not here.
--
--   'prompt'  — never asked at OS level, Apple's dialog is still available
--   'denied'  — refused at OS level, only iOS Settings can undo it
--   'granted' — on
--   null      — never reported (web users, or an app version predating this)

begin;

alter table profiles
  add column if not exists push_permission text
    check (push_permission in ('prompt', 'denied', 'granted'));

-- When that state was last observed, so a stale value is obvious rather than
-- silently trusted months later.
alter table profiles
  add column if not exists push_permission_at timestamptz;

-- Partial: the question is always "who is NOT granted", and null/granted rows
-- are the large majority.
create index if not exists profiles_push_permission_idx
  on profiles (push_permission)
  where push_permission in ('prompt', 'denied');

commit;
