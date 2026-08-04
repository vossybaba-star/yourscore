-- Quiz results join the fantasy feed (founder, 4 Aug — "pull in games that have
-- been played from quiz"). A quiz_result event is emitted when someone finishes
-- a Football Quiz pack (/play) or a gameweek knowledge round with a score worth
-- talking about. payload: { correct, total, title, game: 'quiz' | 'round' }.
-- Reactions + comments already work on any fantasy_feed_events row.

alter table public.fantasy_feed_events drop constraint if exists fantasy_feed_events_type_check;
alter table public.fantasy_feed_events add constraint fantasy_feed_events_type_check
  check (type in ('transfer','captain','chip','haul','rank_jump','squad_complete','squad_update','shortlist_add','post','quiz_result'));
