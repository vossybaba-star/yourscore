-- 257: video fields on the link-preview cache (video build 2D review pass).
--
-- 2D's unfurler now classifies a link as youtube / rich-video / plain.
-- youtube is derived from the URL alone, so caching never affected it — but
-- "rich" (og:video-declared) is PAGE-derived, and without these columns a
-- cache hit dropped it back to a plain card for the whole 7-day cache life.
-- Two nullable columns close that gap; every existing row reads as NULL
-- (plain), exactly what those rows were before.

begin;

alter table public.link_previews add column if not exists video_kind text;
alter table public.link_previews add column if not exists youtube_id text;

commit;
