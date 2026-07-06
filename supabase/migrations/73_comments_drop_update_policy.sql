-- Drop the over-broad UPDATE policy on comments (2026-07-05 audit, M1).
--
-- "comments delete own" (mig 70) granted authenticated users full-column
-- UPDATE on their own comment rows via PostgREST. First-party code never uses
-- it — soft-delete goes through the service role in /api/comments DELETE — so
-- the policy was pure attack surface: a user could post a clean comment (the
-- link/slur door filter only runs in the POST handler), then PATCH the row
-- directly to rewrite `body` to spam or flip `subject_id` onto another thread.
--
-- Service-role writes bypass RLS, so dropping the policy changes nothing for
-- the app; it only closes the direct-PostgREST edit path.

drop policy if exists "comments delete own" on comments;
