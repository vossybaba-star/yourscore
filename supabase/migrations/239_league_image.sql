-- League display picture (founder, 2 Aug). A league's admin can set a crest/photo
-- for their league. Stored in a public `league-avatars` bucket; the URL lands on
-- fantasy_leagues.image_url. Setting the URL is admin-gated in the API (owner
-- check); the raw upload is any authenticated user (the API links it only for the
-- owner's league).

alter table public.fantasy_leagues add column if not exists image_url text;

-- Public bucket for league images.
insert into storage.buckets (id, name, public)
values ('league-avatars', 'league-avatars', true)
on conflict (id) do nothing;

-- Anyone can read (public crests); authenticated users can upload/replace.
drop policy if exists "league_avatars_read" on storage.objects;
create policy "league_avatars_read" on storage.objects
  for select using (bucket_id = 'league-avatars');

drop policy if exists "league_avatars_insert" on storage.objects;
create policy "league_avatars_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'league-avatars');

drop policy if exists "league_avatars_update" on storage.objects;
create policy "league_avatars_update" on storage.objects
  for update to authenticated using (bucket_id = 'league-avatars');

drop policy if exists "league_avatars_delete" on storage.objects;
create policy "league_avatars_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'league-avatars');
