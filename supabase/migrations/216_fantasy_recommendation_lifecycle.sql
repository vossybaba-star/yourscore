-- 216: Captain Assist — recommendation lifecycle and supersede chain.
--
-- The flaw this fixes: the shadow record was upserted, so each new pre-deadline
-- recommendation overwrote the pointer and the HISTORY of what changed was lost.
-- Every generated recommendation is already an immutable row; what was missing
-- was an explicit lifecycle saying which one became official and why the earlier
-- ones stopped being it.
--
-- With this we can later answer:
--   * how often a recommendation changed during the week
--   * whether injury news caused the change
--   * which recommendation the user actually looked at
--   * whether confidence improved closer to the deadline
--   * how long before the deadline the final recommendation was produced
--
-- Lifecycle: provisional -> superseded (an newer one replaced it)
--                        -> final_frozen (the last eligible pre-deadline one)
--                        -> scored
--
-- Additive only.

alter table public.fantasy_captain_recommendation
  add column if not exists status                        text default 'provisional',
  add column if not exists recommendation_version        int  default 1,
  add column if not exists superseded_by_recommendation_id uuid,
  add column if not exists superseded_at                 timestamptz,
  -- why this recommendation stopped being the official one, e.g.
  -- newer_snapshot | availability_change | squad_change | fixture_context_changed
  add column if not exists change_reason                 text;

create index if not exists fantasy_captain_rec_status_idx
  on public.fantasy_captain_recommendation (user_id, gameweek, status);

-- The freeze trigger from 211 guards the frozen FIELDS; lifecycle columns are
-- deliberately outside that guard so a recommendation can be retired without
-- ever rewriting what it actually said.
