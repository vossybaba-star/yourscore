# 38-0 — Interactive penalty shootout: draws ALWAYS go to pens, and you take them

**Date:** 2026-06-12 · **Status:** approved (plan-mode review)

## Problem

A drawn 38-0 match is an anticlimax. Quick match / ranked / challenge draws are terminal
(500 pts each); live H2H asks both players to *opt in* to a shootout that is auto-resolved
server-side and shown as a bare scoreline; WC knockouts auto-resolve pens. None of it is
playable. Every drawn played match should go to penalties — and the user should take the
kicks themselves, like a real computer game.

## Locked decisions

1. **Scope: all played matches.** Local quick match, ranked async, challenge links, live
   H2H (opt-in removed — straight to pens), WC knockouts. The aggregate season sim and WC
   *group* games keep draws (league formats; there is no match on screen to play).
2. **Pens win = full win.** 1500 pts / `creditResult("win")` / streak survives; loser
   gets a loss. No new credit class, no scoring migration.
3. **Live H2H sync: both players shoot simultaneously vs a seeded AI keeper** inside one
   `penalties` phase (75s). Kicks stream to the opponent via the existing
   `draft_live_matches` realtime channel. No alternating turn phases (10–20 synchronized
   sub-phases would be expensive on Supabase IO and fragile on mobile networks).
4. **Solo modes: the user shoots their 5 AND dives as keeper** for the opponent's 5,
   alternating presentation. All interaction is local; ranked outcomes are resolved
   server-side.
5. **Cheap + performant.** No game engine, no new dependencies, DOM/SVG + CSS transforms
   (no rAF loop), tiny pure-logic module, per-kick writes are small jsonb appends.

## Anti-cheat model (shapes the whole design)

If the client can derive the kick outcome from a known seed + its own zone choice, it can
simulate all six zones and submit the one that scores. Therefore:

- **Server pens seeds are peppered:** `pensSeed(key) = HMAC-SHA256(secret, key)` in a
  `server-only` module (`pens-server.ts`). Clients can never precompute the AI keeper or
  the CPU shooter.
- **Ranked kicks resolve per-kick on the server.** The client sends only a zone choice and
  receives a resolved `PenKick`. The CPU's shot zone is revealed only in the response.
- **Guest/local quick match has zero stakes** → runs fully client-side with a plain seed.

## Game mechanic (pure logic — `src/lib/draft/pens.ts`)

- **6 aim zones** (3 columns × 2 heights) for shooting; **3 columns** for the keeper dive.
- `PENS_CONFIG` (single tuning surface, mirrors `LIVE_CONFIG`):
  - wild-miss chance by zone class: center-low 0.01 … corner-high 0.10 (corners riskier);
  - save chance **when the keeper guesses the column**: center-low 0.90 … corner-high 0.30
    (top corners nearly unsaveable even when read);
  - AI keeper column bias [0.36, 0.28, 0.36] (stays home enough to punish lazy centers);
  - CPU shot distribution (corners ~70%).
- Net conversion vs the AI keeper lands ~0.72–0.80 for every strategy — consistent with the
  legacy auto `pConvert` 0.72; corners have the higher ceiling plus a miss tax. A correctly
  guessed dive saves a meaningful fraction, so playing keeper matters. **No strength lean**
  — pens are player skill + seeded luck (squad quality already decided the 90').
- **`resolveRound(seed, side, round, {shot?, dive?}) → PenKick`** is the shared primitive.
  Each kick draws from fresh sub-seeds `${seed}:${side}:${round}:shot|dive|out`, so an
  auto-filled input never shifts any other kick → per-kick server resolution and a full
  recompute are byte-identical (tested invariant).
- **`shootoutStatus(aKicks, bKicks, mode)`**: alternating (solo) uses standard early
  termination; simultaneous (live) lets both sides take all 5 ungated (trivial sync),
  sudden-death round r+1 opens only when both have r kicks and are level.
- **`resolveInteractiveShootout(seed, inputs, mode)`**: full deterministic resolution with
  seeded auto-fill for timeouts/abandonment/bots; always decisive (backstop bounded).
- `resolveShootout` in live-score.ts stays as the legacy/auto path
  (`resolveMatch({allowDraw:false})`, old rows); marked as such.

## UI — `src/components/draft/PenaltyShootout.tsx`

DOM/SVG + CSS transitions (GPU-composited transforms), not canvas — a shootout is ~8
discrete event-driven elements; canvas earns its keep in MatchPitch's 22 continuous dots,
here it's overhead. One controlled component shared by every mode:
`{ view, myName, oppName, simultaneous?, secondsLeft?, pending?, onShoot, onDive }`.

- Front-on SVG goal (posts, faint net grid, turf strip, dark gradient) in the existing
  tokens: `#0a0a0f`/`#12121e` surfaces, me `#00ff87`, opp `#ff5c7a`, amber `#ffb800`,
  bebas display / DM Sans body.
- **Shoot:** tap a zone → ball flies spot→zone (~550ms transform with scale-down for
  depth) while the keeper dives. The kick POST fires on tap so server RTT hides under the
  ball flight. Goal → net ripple + green flash; save → keeper flash + deflect; miss →
  ball exits + brief shake.
- **Dive:** three large L/M/R targets; the opponent's ball flies to its revealed zone as
  your keeper dives to your pick.
- HUD: per-side score pips (● scored ○ failed ◌ pending, extra pips in sudden death),
  `KICK n OF 5` / `SUDDEN DEATH`, final `YOU WIN ON PENS` / `LOST ON PENS` banner.
- Live layout: my shooting lane is the hero; the opponent is a compact streaming strip.
- `prefers-reduced-motion`: skip animations, instant text outcomes.

## Integration per mode

- **Local quick match** (already fully client-side in `team/page.tsx quickMatch()`):
  draw → `LocalMatch.pensPending {mode:"local", seed}` → watch → new page
  `/38-0/match/pens` drives kicks with pens.ts directly → updates LocalMatch
  (`outcome`, `pens`, `pensKicks`), `recordWin/recordLoss`, → result. Abandonment: taken
  zones are stored as you go; next visit auto-completes seeded (quitting ≈ the CPU
  finishes for you).
- **Ranked async + challenge:** on draw the API inserts the `draft_matches` row as
  `detail.outcome="pens_pending"` with `pensState {userSide, shots, dives}` and **defers
  all crediting/streaks/emails**. New endpoint `/api/draft/match/pens`
  (`{matchId, action: "shot"|"dive", zone}`) validates alternation, resolves via
  `resolveRound(pensSeed(...))`, and on decision writes the final outcome and runs the
  deferred credits. **Quit-when-losing killer:** the find/resolve stages sweep the user's
  `pens_pending` rows and auto-complete them seeded before a new match can start; the
  daily cron TTLs strays older than 1h. Abandoning is never better than playing.
- **Live H2H:** `nextPhase`: `half2 → penalties` when level (draw_decision retired;
  legacy rows in it fall through to penalties); `penalties` timer 7→75s; entering
  `penalties` writes nothing; new `liveKick()` + `/api/draft/live/kick` resolves the
  caller's round via `resolveRound` and appends through an atomic round-gated RPC
  (`draft_live_kick`); bot kicks append alongside; entering `result` resolves any
  remaining kicks via `resolveInteractiveShootout` and patches `pens_p1/pens_p2` —
  `outcomeOf()`/`finalize()` are unchanged. Realtime-off degradation: 3s poll during the
  penalties phase; every kick response also returns the fresh row.
- **WC knockouts:** knockout fixtures resolve with `allowDraw: true`; a level game pauses
  the stage (`resolveStageFrom`) and writes `draft_wc_runs.pens_state`; the run page
  renders the shootout in the reveal overlay; `/api/draft/wc/kick` mirrors the solo
  endpoint; `completeWcPens` builds the game row and resumes the stage (the 2-game "ko"
  stage can pend twice). Group draws stand.

## Data

Migration `35_draft_pens.sql` (CLI, applied before code deploys; regen database.ts after):
- `draft_live_matches.p1_kicks / p2_kicks jsonb default '[]'` — resolved
  `{shot, dive, outcome}` per round (clients render, never compute);
- `draft_live_kick(p_match, p_round, p1_kick, p2_kick)` — atomic append gated on
  `phase='penalties'` and `jsonb_array_length = round-1` (double-tap/replay safe);
- `draft_wc_runs.pens_state jsonb`.

## Testing

`pens.test.ts` under the bare-tsc `node --test` harness: determinism; per-kick vs
full-recompute agreement (the server-integrity invariant); conversion envelope per zone
∈ [0.68, 0.84] over ~3k seeded kicks with the mixed mean ∈ [0.72, 0.80]; matched-dive
save bands; auto-fill CPU-vs-AI ≈ 0.72; alternating early termination; simultaneous
sudden-death gating; decisive backstop. `live-score.test.ts` updated for the new
`nextPhase` table. Preview verification per mode with dev-only draw forcing (seed search —
the engine itself is never hooked).

## Risks

- **IO:** ~22 tiny POSTs per drawn ranked match, ~12–16 kick RPCs per live shootout.
  `replica identity full` re-broadcasts the whole live row per kick (squads+sim jsonb) —
  acceptable at current volume; documented fallback is a skinny side table on the
  publication.
- **Deploy-time in-flight matches:** draw_decision rows auto-advance into pens; rows
  already holding pens_p1 finalize unchanged; old clients' `wantsPens` posts are tolerated
  as no-ops for one release.
- **Tuning:** PENS_CONFIG numbers are first-pass; the envelope test pins the sane range.
