-- User-created posts in the public Fantasy feed (Social → Live): a text post,
-- optionally carrying a poll. Turns the feed from auto-generated activity into an
-- actual conversation (founder, 3 Aug). Reactions + comments already work on any
-- fantasy_feed_events row, so a post gets those for free.

alter table public.fantasy_feed_events drop constraint if exists fantasy_feed_events_type_check;
alter table public.fantasy_feed_events add constraint fantasy_feed_events_type_check
  check (type in ('transfer','captain','chip','haul','rank_jump','squad_complete','squad_update','shortlist_add','post'));

-- Poll votes on a feed post (payload.poll). One vote per user per post; app code
-- reads/writes with the service role, RLS is defence-in-depth for direct access.
create table if not exists public.fantasy_feed_poll_votes (
  event_id     uuid not null references public.fantasy_feed_events(id) on delete cascade,
  user_id      uuid not null,
  option_index int  not null,
  created_at   timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.fantasy_feed_poll_votes enable row level security;

drop policy if exists fantasy_feed_poll_votes_select on public.fantasy_feed_poll_votes;
create policy fantasy_feed_poll_votes_select on public.fantasy_feed_poll_votes
  for select to authenticated using (true);

drop policy if exists fantasy_feed_poll_votes_insert on public.fantasy_feed_poll_votes;
create policy fantasy_feed_poll_votes_insert on public.fantasy_feed_poll_votes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists fantasy_feed_poll_votes_update on public.fantasy_feed_poll_votes;
create policy fantasy_feed_poll_votes_update on public.fantasy_feed_poll_votes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
