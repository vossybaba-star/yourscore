-- 06_h2h_server_scoring.sql
-- H5 (h2h) — opponent scores are now graded and written server-side by
-- /api/h2h/play via the service role. Remove the client UPDATE policy whose
-- `with check (true)` let ANY authenticated user overwrite ANY challenge's
-- opponent_score with an arbitrary value (and beat anyone). SELECT (public
-- read for share links) and the challenger INSERT policy are left intact.

begin;

drop policy if exists "Opponent can update their score" on h2h_challenges;

commit;
