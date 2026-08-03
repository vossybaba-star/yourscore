-- Let signed-in users upload their own avatar photo.
--
-- The `avatars` storage bucket had NO policies on storage.objects. RLS is on,
-- so with no INSERT/UPDATE policy every authenticated upload was denied — the
-- settings "change photo" flow has been silently broken since launch (0 of
-- ~10k profiles have an uploaded photo; the working avatars are all preset
-- catalog SVGs or external Google URLs). Only `league-avatars` had policies.
--
-- Avatar files are named "<uid>.<ext>", so scope every write to the caller's
-- own uid — a user can replace their own avatar but not overwrite anyone else's.

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name like (auth.uid()::text || '.%'));

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name like (auth.uid()::text || '.%'))
  with check (bucket_id = 'avatars' and name like (auth.uid()::text || '.%'));

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name like (auth.uid()::text || '.%'));

-- The bucket is public, so reads already work via the CDN; an explicit SELECT
-- policy keeps the storage API's list/read consistent and mirrors league-avatars.
create policy "avatars_read_public" on storage.objects
  for select to public
  using (bucket_id = 'avatars');
