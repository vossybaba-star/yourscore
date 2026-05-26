-- Device push tokens for native iOS / Android clients.
-- Paste into the Supabase SQL editor once.

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, token)
);

create index if not exists device_tokens_user_idx on device_tokens (user_id);

alter table device_tokens enable row level security;

create policy "Users insert own device tokens" on device_tokens
  for insert with check (auth.uid() = user_id);

create policy "Users read own device tokens" on device_tokens
  for select using (auth.uid() = user_id);

create policy "Users delete own device tokens" on device_tokens
  for delete using (auth.uid() = user_id);
