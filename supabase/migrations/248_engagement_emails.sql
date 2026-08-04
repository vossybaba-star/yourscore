-- 248_engagement_emails.sql — the email fallback for non-app users (founder, 4 Aug).
-- Twitter-style engagement (likes, comments, feed reactions) already lands in the
-- notifications inbox. This adds the seam the email layer needs:
--   • emailed_at  — when we emailed the recipient about THIS row. NULL = still held
--     for the end-of-day digest. The immediate path (first 2 a day) stamps it now;
--     the digest cron stamps the rest.
--   • feed_reaction aggregation — one inbox row per feed post that got reactions,
--     mirroring the comment_like aggregate (count+swap latest actor). Fills the gap
--     where liking a feed post notified NOBODY.
-- Additive, service-role writes only (notifications already denies anon/auth writes).
begin;

alter table notifications add column if not exists emailed_at timestamptz;

-- One aggregated row per feed post that got reactions (subject_id = event id,
-- type = 'feed_reaction'). Same shape as notifications_like_agg_idx for comments.
create unique index if not exists notifications_feed_react_agg_idx
  on notifications (subject_id) where type = 'feed_reaction';

-- The digest cron scans for un-emailed engagement rows per user. Partial index
-- keeps that sweep cheap (only the held rows, never the whole table).
create index if not exists notifications_email_pending_idx
  on notifications (user_id, created_at) where emailed_at is null and user_id is not null;

commit;
