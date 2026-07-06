-- First-touch acquisition source per user: UTM params + referrer captured on the
-- landing page, written to the profile at signup. Lets us attribute retained
-- players to the platform/campaign that acquired them (there was previously NO
-- source tracking anywhere, so cross-platform ROI was impossible to compute).
-- Applied to prod via the Management API on 2026-07-06.
alter table public.profiles
  add column if not exists source text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists referrer text;
