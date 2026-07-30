-- Likes on discussion comments (packs + debates). ADDITIVE.
-- Mirrors debate_votes: self-write RLS, API aggregates counts via service role.
begin;

create table if not exists comment_likes (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table comment_likes enable row level security;
drop policy if exists "comment_likes self" on comment_likes;
create policy "comment_likes self" on comment_likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists comment_likes_comment_idx on comment_likes (comment_id);

commit;
