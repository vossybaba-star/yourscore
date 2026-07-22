-- 80_fantasy_scoring_version.sql — stamp the scoring values a gameweek was scored under.
--
-- values.ts exports SCORING_VERSION and nothing ever read it. If we ever tune the
-- point values mid-season (the defensive-contribution award is the live dial), old
-- and new gameweeks become silently incomparable — and a season table that sums
-- them is quietly wrong, with nothing to show for it. Stamping the version makes a
-- values change detectable, and a re-score of the affected gameweeks possible.
begin;

alter table fantasy_entries
  add column if not exists scoring_version text;

commit;
