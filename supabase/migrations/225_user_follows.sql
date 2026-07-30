-- 225_user_follows.sql
-- One-way follow graph, app-wide — a NEW layer alongside the mutual `friendships`
-- system (both coexist: friends = play-together, follow = spectate/feed). Follow
-- is instant, no accept. Powers the fantasy activity feed's "Following" and
-- follower/following counts on profiles, and lives on every social surface
-- (quizzes, 38-0, fantasy).
--
-- Public graph (any signed-in user can read who follows whom, like IG); you may
-- only create/remove your OWN follows. Reads/writes go through the user's client
-- under RLS — no service role needed.

create table if not exists public.user_follows (
  follower_id uuid not null,
  followee_id uuid not null,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint user_follows_no_self check (follower_id <> followee_id)
);

create index if not exists user_follows_followee_idx on public.user_follows (followee_id);
create index if not exists user_follows_follower_idx on public.user_follows (follower_id);

alter table public.user_follows enable row level security;

drop policy if exists user_follows_select on public.user_follows;
create policy user_follows_select on public.user_follows
  for select to authenticated using (true);

drop policy if exists user_follows_insert on public.user_follows;
create policy user_follows_insert on public.user_follows
  for insert to authenticated with check (follower_id = auth.uid());

drop policy if exists user_follows_delete on public.user_follows;
create policy user_follows_delete on public.user_follows
  for delete to authenticated using (follower_id = auth.uid());
