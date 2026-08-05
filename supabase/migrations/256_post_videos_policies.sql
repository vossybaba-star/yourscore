-- Video attachments on Social posts (native video upload, 5 Aug — X-level: post
-- video). The `post-videos` bucket ALREADY EXISTS on prod (public, 100MB cap,
-- mime video/mp4 + video/quicktime) — this migration only adds the storage RLS
-- policies, mirroring 244_post_media_bucket.sql exactly. A public bucket so
-- feed videos play for everyone; a user may write only under their own
-- "<uid>/" prefix. postToFeed additionally checks the URL is from this bucket,
-- so a post can't embed an arbitrary external video.

-- Idempotent safety insert for a fresh environment only — on prod this is a
-- no-op (bucket already exists with this exact config: public, 100MB file
-- size cap, mime video/mp4 + video/quicktime).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('post-videos', 'post-videos', true, 104857600, array['video/mp4', 'video/quicktime'])
  on conflict (id) do nothing;

drop policy if exists "post_videos_read" on storage.objects;
create policy "post_videos_read" on storage.objects
  for select using (bucket_id = 'post-videos');

drop policy if exists "post_videos_insert_own" on storage.objects;
create policy "post_videos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-videos' and name like (auth.uid()::text || '/%'));

drop policy if exists "post_videos_delete_own" on storage.objects;
create policy "post_videos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-videos' and name like (auth.uid()::text || '/%'));
