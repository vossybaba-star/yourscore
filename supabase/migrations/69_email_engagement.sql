-- Email engagement recency, keyed by address. Fed by the Resend webhook
-- (email.opened / email.clicked). Purpose: stop mailing chronically-unengaged
-- people — repeatedly emailing addresses that never open/click trains Gmail/Apple
-- to route the domain to junk, so this lets us suppress dead weight and protect
-- inbox placement (see [[project_yourscore_resend]]).
--
-- Opens and clicks are stored SEPARATELY on purpose: opens are noisy (Apple Mail
-- Privacy pre-loads the pixel, inflating them), while clicks are a reliable human
-- signal. A future "hasn't engaged in N days" suppression can weight clicks over opens.
--
-- No email is sent from here; PII-light (just an address + timestamps). Service-role only.

create table if not exists public.email_engagement (
  email text primary key,
  last_opened_at timestamptz,
  last_clicked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Recency lookups for suppression queries.
create index if not exists email_engagement_opened_idx on public.email_engagement (last_opened_at);
create index if not exists email_engagement_clicked_idx on public.email_engagement (last_clicked_at);

-- Lock down: only the service role (webhook + send scripts) touches this.
alter table public.email_engagement enable row level security;
revoke all on public.email_engagement from anon, authenticated;
