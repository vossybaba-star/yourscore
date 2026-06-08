-- 21_draft_live_sim.sql
-- Rich live-match simulation: per-half goal scorers, assists, player ratings,
-- corners and throw-ins — surfaced as the half-time report and full-time stats.
-- The scoreline (h1_p1 … h2_p2) is unchanged; this is the extra detail, computed
-- server-side at each half's resolution (squads change between halves, so the
-- client can't reconstruct it) and accumulated here. ADDITIVE.

begin;

alter table draft_live_matches add column if not exists sim jsonb;

commit;
