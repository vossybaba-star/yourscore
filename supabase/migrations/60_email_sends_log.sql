-- Frequency-cap log for segment email campaigns. segments.mjs records every
-- recipient of every campaign here, then excludes anyone emailed within the cap
-- window from the next campaign — so the "max N per person" guardrail is enforced,
-- not just promised. Service role only.
create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  campaign_key text not null,
  sent_at timestamptz not null default now()
);
create index if not exists email_sends_user_sent_idx on public.email_sends (user_id, sent_at desc);
create index if not exists email_sends_campaign_idx on public.email_sends (campaign_key, sent_at desc);
alter table public.email_sends enable row level security;
revoke all on public.email_sends from anon, authenticated;
