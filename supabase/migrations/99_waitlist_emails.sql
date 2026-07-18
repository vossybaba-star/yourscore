-- Waitlist capture fallback (Fantasy launch).
--
-- /api/waitlist stores signups in the Resend "Fantasy Waitlist" audience, which
-- needs RESEND_CAMPAIGNS_API_KEY (the base key is sending-only and 401s on
-- /audiences). Until that env var exists on Vercel — and any time Resend
-- hiccups — the route was a 502 and the signup was LOST.
--
-- This table is the ledger the route writes FIRST; Resend becomes best-effort
-- sync. `synced_at` marks rows that made it into the audience, so a backfill
-- can push the stragglers once the key lands (scripts/waitlist-backfill.mjs).

create table if not exists public.waitlist_emails (
  email       text primary key,
  source      text not null default 'unknown',   -- 'blog' | 'fantasy-hold' | …
  created_at  timestamptz not null default now(),
  synced_at   timestamptz                        -- null = not yet in the Resend audience
);

-- Service-role only (the API route); deny-all otherwise.
alter table public.waitlist_emails enable row level security;
revoke all on public.waitlist_emails from public;
