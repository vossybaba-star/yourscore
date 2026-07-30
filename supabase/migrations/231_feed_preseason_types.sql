-- 231_feed_preseason_types.sql
-- Pre-season, nobody is playing chips or making transfers — the season hasn't
-- started. What managers actually DO before GW1 is build and finalise their
-- squads and add players to their shortlist. Add those event types to the feed
-- so it reflects what's really happening:
--   squad_complete — finalised their squad (the tile shows the XI, with faces)
--   squad_update   — reshaped their squad / added a player while building
--   shortlist_add  — shortlisted a player
-- The transfer/captain/chip/haul/rank_jump types stay — they come alive at GW1.

alter table public.fantasy_feed_events drop constraint if exists fantasy_feed_events_type_check;
alter table public.fantasy_feed_events add constraint fantasy_feed_events_type_check
  check (type in ('transfer','captain','chip','haul','rank_jump','squad_complete','squad_update','shortlist_add'));
