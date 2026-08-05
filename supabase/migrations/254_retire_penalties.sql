-- 254: penalties feature retired (2026-08-05).
-- Data-only fix: quick/challenge matches parked mid-shootout (detail.outcome =
-- 'pens_pending') can never settle now that the pens routes are gone — record
-- them as the draws they were at 90'. Goals are already level on these rows and
-- winner_id is already null, so only the detail needs rewriting. The transient
-- pensState blob goes with it. No schema change: pens columns (draft_matches
-- detail, draft_live_matches.pens_p1/p2/p1_kicks/p2_kicks, draft_wc_matches
-- pens_you/opp, draft_wc_runs.pens_state) stay in place for historical rows.
update draft_matches
set detail = jsonb_set(detail, '{outcome}', '"draw"'::jsonb) - 'pensState' - 'pens'
where detail ->> 'outcome' = 'pens_pending';

-- The round-gated kick appender is dead code now.
drop function if exists draft_live_kick(uuid, int, jsonb, jsonb);
