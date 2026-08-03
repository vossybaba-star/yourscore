-- Image attachments on Social posts (founder, 3 Aug — X-level: post images). A
-- public bucket so feed images render for everyone; a user may write only under
-- their own "<uid>/" prefix. postToFeed additionally checks the URL is from this
-- bucket, so a post can't embed an arbitrary external image.

insert into storage.buckets (id, name, public)
  values ('post-media', 'post-media', true)
  on conflict (id) do nothing;

drop policy if exists "post_media_read" on storage.objects;
create policy "post_media_read" on storage.objects
  for select using (bucket_id = 'post-media');

drop policy if exists "post_media_insert_own" on storage.objects;
create policy "post_media_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-media' and name like (auth.uid()::text || '/%'));

drop policy if exists "post_media_delete_own" on storage.objects;
create policy "post_media_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-media' and name like (auth.uid()::text || '/%'));
