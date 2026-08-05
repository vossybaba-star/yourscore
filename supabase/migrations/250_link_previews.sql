-- 250: Link preview cache (Social Phase 2b — composer + feed link unfurling).
--
-- /api/unfurl fetches a URL's og:title/og:description/og:image server-side
-- (never client-side — that would leak the poster's IP and let a post URL
-- probe internal hosts) and caches the parsed result here for 7 days, keyed
-- by a hash of the normalised URL so the same link posted by many managers
-- costs one fetch.
--
-- RLS is enabled with NO policies => deny-all for anon/authenticated.
-- service_role (the /api/unfurl route) bypasses RLS — a preview is read only
-- through the route, never directly by a client. Mirrors migration 247
-- (fantasy_squad_rating).
--
-- The route degrades to fetch-without-cache if this table is absent or the
-- read/write errors (unfurl.ts wraps every query in try/catch) — this
-- migration is written but deliberately NOT applied yet, so that fallback
-- path is load-bearing until it ships.

begin;

create table if not exists public.link_previews (
  url_hash    text primary key,
  url         text not null,
  title       text,
  description text,
  site_name   text,
  image       text,
  fetched_at  timestamptz not null default now()
);

create index if not exists link_previews_fetched_at_idx
  on public.link_previews (fetched_at desc);

alter table public.link_previews enable row level security; -- no policies: service-role only

commit;
