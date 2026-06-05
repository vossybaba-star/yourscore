-- 11_realtime_replica_identity.sql
-- Fix multiplayer realtime requiring manual reloads.
--
-- These tables are published to `supabase_realtime` and have RLS enabled, but
-- their REPLICA IDENTITY was DEFAULT (primary key only). With RLS on, Supabase
-- Realtime needs the full row to (a) evaluate row-level access and (b) apply
-- `filter` clauses (e.g. room_id=eq.X) on UPDATE/DELETE events — otherwise those
-- events are silently dropped. That's why:
--   • tapping "Start" did nothing (rooms UPDATE status->live never delivered),
--   • progression stalled (rooms current_question_idx UPDATE never delivered),
--   • the leaderboard / lobby only updated after a manual reload.
--
-- REPLICA IDENTITY FULL makes the complete old+new row available to logical
-- replication so Realtime delivers UPDATE/DELETE (and filtered) events reliably.

alter table rooms            replica identity full;
alter table room_members     replica identity full;
alter table room_scores      replica identity full;
alter table question_events  replica identity full;
alter table answers          replica identity full;
