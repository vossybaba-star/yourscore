-- 54_leagues_owner_delete.sql
-- Let a quiz-league creator delete their own league. The leagues table had
-- insert/read/update policies but no DELETE policy, so RLS denied all deletes —
-- there was no way to remove a league once created. Mirror the update policy:
-- only the creator (auth.uid() = created_by) may delete. league_members rows
-- cascade away via the existing ON DELETE CASCADE fkey.

drop policy if exists "leagues_delete" on leagues;
create policy "leagues_delete" on leagues
  for delete to public
  using (auth.uid() = created_by);
