-- 32_io_hardening.sql
-- Pre-World-Cup write-load reduction. Findings from the Jun 12 audit: the Nano
-- outage was WAL/write-volume driven, and most of that volume came from a few
-- hot paths that don't need durable, fully-logged writes. Everything here is
-- zero-behavior-change for the app.
--
-- Applied to production via Management API on 2026-06-12 (recorded in
-- schema_migrations); this file is the source-of-truth record.

-- 1. Rate-limit state is disposable (worst case after a crash: one window of
--    counters resets). UNLOGGED stops WAL-logging the upsert that EVERY rate-
--    limited API request performs (~83k updates/day observed).
alter table rate_limits set unlogged;

-- 2. Replica identity FULL is only needed by UPDATE/DELETE realtime subscribers
--    (old-row payloads). All subscriptions on these two tables are INSERT-only
--    (play/[roomId] page), so FULL was WAL-logging entire old rows on every
--    UPDATE for nothing. rooms / room_scores / draft_live_matches keep FULL —
--    their UPDATE subscribers genuinely need it (see migration 11).
alter table question_events replica identity default;
alter table room_members replica identity default;

-- 3. Missing indexes for hot lookups:
--    findActiveMatch (live-server.ts) scans draft_live_matches by p1_id/p2_id
--    with a non-terminal-phase filter on every matchmaking poll (every 1.5s per
--    searching user) — was a growing seq scan. Partial indexes match the query
--    predicate exactly and stay tiny (active matches only).
create index if not exists draft_live_active_p1_idx
  on draft_live_matches (p1_id) where phase not in ('result', 'abandoned');
create index if not exists draft_live_active_p2_idx
  on draft_live_matches (p2_id) where phase not in ('result', 'abandoned');

--    Challenge-page leaderboards order quiz_attempts by score within a pack
--    (challenges/[slug] page + wc2026 leaderboard route) — only the
--    UNIQUE(user_id, pack_id) key existed, which can't serve that scan.
create index if not exists quiz_attempts_pack_score_idx
  on quiz_attempts (pack_id, score desc);
