-- Where each user is, so notification windows (morning commute, lunch, evening)
-- can be computed in THEIR local time, not a single market's.
--
-- timezone: exact IANA zone (e.g. 'Europe/London', 'Africa/Lagos',
--   'America/New_York') captured client-side from
--   Intl.DateTimeFormat().resolvedOptions().timeZone — free and precise.
-- country: ISO-2 from the Vercel edge geo header, a server-side fallback.
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists country  text;

comment on column public.profiles.timezone is
  'IANA timezone from the client; drives local-time send windows. Null = fall back to country/default.';
comment on column public.profiles.country is
  'ISO-2 country from edge geo header; coarse fallback when timezone is unknown.';
