-- Venue leagues (founder 8 Aug): a new league `kind = 'venue'` (pubs, clubs, bars
-- running YourScore). `kind` already exists (245) and has no CHECK, so 'venue' is
-- just a new value. Venue-specific content lives in one jsonb blob, mirroring the
-- bio/links precedent (263):
--
--   {
--     "info":    "free text about the venue",
--     "offers":  [ { "title": "...", "detail": "...", "expiresAt": "ISO?" } ],
--     "contact": { "people": [ { "name": "...", "role": "...", "handle": "?" } ],
--                  "helpEmail": "help@venue.example" }
--   }
--
-- Admin creates a venue league + assigns the owner; the owner edits venue_meta via
-- league settings (owner-gated, service-role write like every other league field).
alter table public.fantasy_leagues
  add column if not exists venue_meta jsonb not null default '{}'::jsonb;

-- Find venues fast (the discover/list surfaces filter by kind).
create index if not exists fantasy_leagues_kind_venue_idx
  on public.fantasy_leagues (kind) where kind = 'venue';
