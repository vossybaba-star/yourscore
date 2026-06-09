# 38-0 — "Watch the Half" — implementation plan

Implements `2026-06-09-38-0-watch-the-match-design.md`. Branch: `38-0-watch-the-match`
(off `main`). Each phase is independently shippable; verify after each.

## Phase 1 — Playback core (`src/lib/draft/playback.ts`) + tests
Pure, seeded module — no React, no DB. Imports only `seededRng` from `score.ts` and the
`HalfSim`/`GoalEvent` types from `live-score.ts`.
- `WATCH_CONFIG = { halfSeconds: 30, matchMinutesPerHalf: 45, shotCommentaryShare: 0.33, maxBeatsPerMinute, … }`.
- `scheduleBeats(seed, count, maxMinute): number[]` — `count` sorted minutes in `[1, maxMinute]`
  from `seededRng(seed)`; length always == `count`.
- `watchFrame(sim, half, matchId, progress): WatchFrame` returning `{ clockMinute, goalsA,
  goalsB, stats, feed }`:
  - clock `= clamp(floor(progress*45),0,45) (+45 if half 2)`.
  - goals = `sim.events` with mapped minute ≤ clock, counted per side.
  - stats: per countable stat, count of `scheduleBeats(`${matchId}:${half}:${k}`, final, 45)`
    ≤ clock; possession eases linearly to final split.
  - feed: goals + scheduled corner/shot/offside beats + kickoff/half-time/full-time bookends,
    sorted by minute, sliced to ≤ clock; text templated (seeded pick).
- **Tests (`playback.test.ts`, add to `run-tests.sh` list + `node --test` glob already covers
  `lib/draft/*.test.js`):** monotonic reveal; `progress=1` ⇒ goals == all events & every stat
  == final & feed has every goal; `scheduleBeats` deterministic & exact length; clock bounds.

## Phase 2 — `<MatchWatch>` component (`src/components/draft/MatchWatch.tsx`)
Presentational; all timing injected via `progress`. Props `{ sim, half, matchId, progress,
priorGoals:{a,b}, meSide, myName, oppName }`. Renders: running clock (`clockMinute'`), big
aggregate scoreline `priorGoals + goalsX` that animates on change, stat bars (reuse the
result-card bar markup/styling from `match/[id]/page.tsx`), and an auto-scrolling commentary
feed from `frame.feed`. No data fetching.

## Phase 3 — Live integration
- `live-score.ts`: `LIVE_CONFIG.timers.half1` & `half2` `7 → 30`.
- `live/match/[id]/page.tsx`: replace the static `half1`/`half2` `<Panel>` (the "x – y this
  half" block) with `<MatchWatch sim={sim![hN]} half={N} matchId={m.id}
  progress={clamp(1 - (secondsLeft ?? 0)/30, 0, 1)} priorGoals={N===2 ? {a:h1[0],b:h1[1]} : {a:0,b:0}} … />`.
  Guard `sim?.hN` (render a "kicking off…" beat until the server writes it). Half-time/result
  panels unchanged.

## Phase 4 — Quick Match integration
- `live-score.ts`: add `sim: MatchSim` to `SingleMatchResult` and return it from `resolveMatch`
  (already built internally).
- `local.ts`: add `sim: MatchSim` to `LocalMatch`; bump key `:v2 → :v3`.
- `team/page.tsx` `quickMatch()`: store `res.sim`; route to `/38-0/match/watch` instead of
  `/38-0/match/result`.
- New `src/app/38-0/match/watch/page.tsx` (client): load last match; local `requestAnimationFrame`
  ticker drives `progress` 0→1 over `WATCH_CONFIG.halfSeconds` for h1, a brief half-time
  interstitial (H1 report card, ~4s or tap), then h2, then `router.replace("/38-0/match/result")`.
  Reuses `<MatchWatch>`.

## Phase 5 — Verify
- `npx tsc --noEmit` clean; `bash scripts/draft/run-tests.sh` green (incl. `playback.test.ts`);
  ESLint clean on touched files.
- Preview: seed a complete team → guest Quick Match → watch h1 (30s) with goals landing at
  their minute, scoreline popping, stats ticking, commentary scrolling → half-time → h2 →
  result. Confirm no console errors.
- Update `DRAFT-XI.md` (live match section: halves now play out over 30s) + `graphify update .`.

## Risks / notes
- Spoiler-via-devtools accepted (Approach A). Live wall-time grows ~46s (intended).
- Keep `<MatchWatch>` dumb and `playback.ts` pure so both are testable in isolation.
- Out of scope: async-ranked & challenge-accept watch screens (follow-on).
