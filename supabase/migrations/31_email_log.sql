-- One row per (user, template) — lets one-shot lifecycle emails (e.g. the
-- comeback nudge) guarantee at-most-once delivery across cron runs.
create table if not exists email_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  template text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, template)
);

-- Service-role only: RLS on with no policies means anon/authenticated can't
-- read or write; the cron job uses the service key which bypasses RLS.
alter table email_log enable row level security;
