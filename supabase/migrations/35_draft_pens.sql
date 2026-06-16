-- 38-0 interactive penalty shootout (spec: 2026-06-12-38-0-interactive-penalties-design.md)
--
-- Live H2H: per-kick storage. Each entry is a fully RESOLVED kick
-- {"shot": 0-5, "dive": 0-2, "outcome": "goal"|"saved"|"missed"} appended by the
-- server (clients only render — outcomes are never computed client-side).
-- The final pens_p1/pens_p2 columns keep their meaning (shootout score), so
-- outcome derivation, finalize and the scorecard are untouched.

alter table draft_live_matches
  add column if not exists p1_kicks jsonb not null default '[]'::jsonb,
  add column if not exists p2_kicks jsonb not null default '[]'::jsonb;

-- Atomic per-kick append, gated on phase + the exact next round per side, so a
-- double-tap, a retry, or a racing duplicate request can never append twice.
-- p1_kick/p2_kick are nullable so a bot match can append both sides in one call.
create or replace function draft_live_kick(
  p_match uuid,
  p_round int,
  p1_kick jsonb default null,
  p2_kick jsonb default null
)
returns setof draft_live_matches
language sql
security definer
set search_path = public
as $$
  update draft_live_matches set
    p1_kicks = case when p1_kick is null then p1_kicks else p1_kicks || jsonb_build_array(p1_kick) end,
    p2_kicks = case when p2_kick is null then p2_kicks else p2_kicks || jsonb_build_array(p2_kick) end
  where id = p_match
    and phase = 'penalties'
    and resolved_at is null
    and (p1_kick is null or jsonb_array_length(p1_kicks) = p_round - 1)
    and (p2_kick is null or jsonb_array_length(p2_kicks) = p_round - 1)
  returning *;
$$;

-- Only the server (service role) takes kicks; clients read the row as usual.
revoke execute on function draft_live_kick(uuid, int, jsonb, jsonb) from public, anon, authenticated;

-- World Cup Run: a knockout game paused mid-stage for its shootout.
-- {"stage": "...", "idx": 0, "goals": {"you": n, "opp": n},
--  "outcomesSoFar": [...], "shots": [0-5...], "dives": [0-2...]}
alter table draft_wc_runs add column if not exists pens_state jsonb;
