-- 38-0 / Draft XI — short share links for season results.
--
-- The season-result share card used to encode the ENTIRE payload (record, XI of
-- 11 players, awards…) in the URL query string, producing very long, messy links.
-- This stores the payload server-side under a short id so the shared link is
-- compact (…/38-0/s/k7Qm2xA). Purely additive — nothing else changes.
--
-- All access is via the service role (the API routes); RLS is enabled with no
-- public policies, so the table is closed to the anon/auth keys.

begin;

create table if not exists draft_shares (
  id text primary key,                 -- short slug, e.g. 'k7Qm2xA'
  payload jsonb not null,              -- the season-og params {w,d,l,pts,…,xi}
  created_at timestamptz default now()
);

alter table draft_shares enable row level security;

commit;
