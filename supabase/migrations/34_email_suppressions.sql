-- Email suppressions table
-- Populated automatically by the Resend webhook (/api/webhooks/resend)
-- on email.bounced and email.complained events.
-- All send scripts query this table before sending.

create table if not exists public.email_suppressions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  reason      text not null, -- 'bounce' | 'complaint' | 'manual'
  detail      text,          -- bounce type or complaint subtype from Resend
  created_at  timestamptz not null default now(),
  constraint email_suppressions_email_unique unique (email)
);

alter table public.email_suppressions enable row level security;

-- No public access — service role only
create policy "service role full access"
  on public.email_suppressions
  for all
  using (auth.role() = 'service_role');

-- Fast lookup by email
create index if not exists email_suppressions_email_idx
  on public.email_suppressions (lower(email));
