-- First-touch acquisition source per PLAY (not just per signup). Mirrors the
-- profiles columns from migration 74, but stamped on each WC run and solo quiz
-- attempt at creation, so plays-per-platform/campaign is a direct DB query —
-- including plays by users who signed up before source-capture existed and
-- guests who never sign up. Client sends the stored ys:acq first-touch blob;
-- the API sanitizes and writes it.
alter table public.draft_wc_runs
  add column if not exists source text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;

alter table public.quiz_attempts
  add column if not exists source text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text;
