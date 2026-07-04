-- Versus phase 2: daily debates + discussion threads.
-- ADDITIVE. Two independent pieces:
--   1. debates + debate_votes: one subjective football question rotates daily
--      (date-seeded over the active bank — no scheduler needed). One vote per
--      user per debate, changeable; the payoff is the live community split.
--   2. comments: one polymorphic thread table for quiz packs and debates
--      (subject_type + subject_id). Soft delete, own-row write, world read.

begin;

-- 1. Debates ---------------------------------------------------------------
create table if not exists debates (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  -- 2-4 short option labels, e.g. ["Yes, already", "Not yet"]
  options    jsonb not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table debates enable row level security;
drop policy if exists "debates read" on debates;
create policy "debates read" on debates
  for select using (true);
-- writes are seed-script / service-role only (no insert/update policy)

create index if not exists debates_active_idx
  on debates (created_at) where active;

create table if not exists debate_votes (
  debate_id  uuid not null references debates(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  option_idx smallint not null check (option_idx >= 0 and option_idx <= 3),
  created_at timestamptz not null default now(),
  primary key (debate_id, user_id)
);
alter table debate_votes enable row level security;
-- Users write their own vote; the community split is aggregated by the API
-- (service role), so votes themselves stay own-readable only.
drop policy if exists "debate_votes self" on debate_votes;
create policy "debate_votes self" on debate_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists debate_votes_debate_idx on debate_votes (debate_id);

-- 2. Discussions -------------------------------------------------------------
create table if not exists comments (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('pack', 'debate')),
  subject_id   uuid not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 280),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table comments enable row level security;
-- World-readable (threads are public), authors insert/soft-delete their own.
drop policy if exists "comments read" on comments;
create policy "comments read" on comments
  for select using (deleted_at is null);
drop policy if exists "comments insert own" on comments;
create policy "comments insert own" on comments
  for insert with check (auth.uid() = user_id);
drop policy if exists "comments delete own" on comments;
create policy "comments delete own" on comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists comments_subject_idx
  on comments (subject_type, subject_id, created_at desc) where deleted_at is null;

commit;
