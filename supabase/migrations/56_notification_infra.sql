-- Push-notification infrastructure: at-most-once delivery log + per-user
-- send-time hint. Used by src/lib/notify.ts and the WC Mastermind cron.

-- One row per (user, key) — guarantees a given notification (e.g.
-- "wc-mastermind:2026-06-22") reaches a user at most once, across cron retries.
create table if not exists notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Service-role only (RLS on, no policies): the cron uses the service key.
alter table notification_log enable row level security;

-- Inferred best send hour (0–23, UTC) from each user's play history. A play-hour
-- in UTC already encodes the user's local rhythm, so we never need a timezone:
-- send at the hour they're habitually active. null → use the cron's fallback hour.
alter table public.profiles add column if not exists active_hour_utc smallint;
comment on column public.profiles.active_hour_utc is
  'Best send hour 0-23 UTC, inferred from quiz_attempts/draft_matches history; null = fallback.';
