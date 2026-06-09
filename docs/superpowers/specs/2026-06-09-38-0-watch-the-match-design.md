# 38-0 — "Watch the Half" match playback

**Date:** 2026-06-09
**Status:** Design approved, ready for implementation plan

## Context

38-0 head-to-head matches currently resolve a half **instantly**: when the live phase
machine enters `half1`/`half2`, the server computes the whole half and the client just
shows the finished scoreline and counts down ~7s. The guest Quick Match is worse — it
resolves both halves locally and jumps straight to the result page. There's no drama.

We want the half to **play out in front of the user**: a sped-up ~45 minutes compressed
into **30 seconds**, where the clock runs, goals land at their minute, stats tick up, and
a Championship-Manager-style commentary feed scrolls. This is a **presentation layer** —
the match result is unchanged; we're animating data the client already has.

## Decisions (locked)

- **Scope:** Live two-player H2H **and** the guest/practice Quick Match (vs CPU).
  Out of scope for now: authed *async ranked* and *challenge-accept* (they keep routing
  straight to the result page; easy follow-on).
- **Duration:** **30 seconds per half** (45 match-minutes → 30 real-seconds).
- **No skip button.** Always watch the full half.
- **Feel:** match clock + aggregate scoreline that pops on goals + ticking stat bars
  (possession, shots, shots-on-target, corners) + a scrolling commentary feed.
- **Architecture:** **client-side playback** of the already-computed half (Approach A).
  The final score is technically present in client state during the 30s (peekable via dev
  tools) — acceptable for a casual game; both players get the same outcome regardless.

## What already exists (reuse — do not change)

- `simulateHalf()` / `resolveMatch()` in `src/lib/draft/live-score.ts` — produce a
  `HalfSim` with `events` (each `{ minute, side, scorerName, assistName? }`, minutes
  1–45 for h1 / 46–90 for h2) and the half's **final** stat totals (possession, shots,
  shotsOnTarget, corners, fouls, offsides, throwins).
- The live phase machine + `useLiveMatch` (`src/lib/draft/useLiveMatch.ts`) already expose
  `secondsLeft` from the **authoritative phase deadline**, and write the full `HalfSim` to
  `m.sim` on phase entry — so the client has the whole half timeline immediately.
- `seededRng()` in `src/lib/draft/score.ts` — for deterministic, both-clients-identical
  schedules.
- The result page (`src/app/38-0/match/result/page.tsx`) and report card stat-bar styling
  — unchanged; playback ends by handing off to them.

## Components

### 1. Playback core — `src/lib/draft/playback.ts` (new, pure, seeded)

The single source of "what's on screen at progress `p` (0→1)". Pure → `node --test`.

```ts
export const WATCH_CONFIG = {
  halfSeconds: 30,
  matchMinutesPerHalf: 45,
  // commentary density, beat templates, etc.
} as const;

export type Beat = {
  minute: number;                 // match minute (1–90)
  kind: "kickoff" | "goal" | "corner" | "shot" | "offside" | "halftime" | "fulltime";
  side?: "a" | "b";
  text: string;                   // "23' ⚽ GOAL — Salah (De Bruyne)"
};

export type WatchFrame = {
  clockMinute: number;            // displayed match minute
  goalsA: number; goalsB: number; // goals revealed SO FAR this half
  stats: SideStats;               // current (ticking) values for each side
  feed: Beat[];                   // beats revealed so far, time-ordered
};

// Pure: deterministic given (sim, half, matchId, progress).
export function watchFrame(sim: HalfSim, half: 1 | 2, matchId: string, progress: number): WatchFrame;

// Deterministic timestamp schedule for a countable stat (sorted minutes in [1,45]).
function scheduleBeats(seed: string, count: number, maxMinute: number): number[];
```

- **Clock:** `clockMinute = clamp(floor(progress * 45), 0, 45) + (half === 2 ? 45 : 0)`.
- **Goals revealed:** `sim.events` with `(minute - base) <= clockMinute - base` → counted by side.
- **Stats:** for each countable stat, `scheduleBeats(`${matchId}:${half}:${stat}`, finalCount, 45)`;
  displayed value = number of scheduled minutes ≤ clockMinute. Total scheduled == final, so
  at `progress = 1` every stat equals the sim's real total. Possession eases toward its final split.
- **Feed:** merge goal events + a moderate subset of stat beats (corners, ~⅓ of shots as
  "Saved!"/"Off the post!"/"Wide", offsides) + kickoff/half-time/full-time bookends; sort by
  minute; return those ≤ clockMinute. Seeded, so both live clients render the identical feed.

### 2. `<MatchWatch>` component — `src/components/draft/MatchWatch.tsx` (new)

Presentational. Props: `sim: HalfSim`, `half`, `matchId`, `progress`, `priorGoals: {a,b}`
(the previous half's final, so the **aggregate** scoreline continues), `meSide`, names.
Renders: running clock, big aggregate scoreline (pops on goal reveal), stat bars, and the
commentary feed (auto-scrolling). Reads everything from `watchFrame(...)`. No timing logic
of its own — `progress` is injected.

### 3. Live integration — `src/app/38-0/live/match/[id]/page.tsx`

- Bump `LIVE_CONFIG.timers.half1` and `half2` from `7` → `30` in `live-score.ts`.
- Replace the static `half1`/`half2` panel (currently "x – y this half") with
  `<MatchWatch sim={sim.hN} half={N} matchId={m.id} progress={1 - secondsLeft/30} priorGoals=… />`.
- `priorGoals` for half2 = the final h1 split; for half1 = `{a:0,b:0}`.
- Half-time (`halftime_swap`, with its H1 report + swaps) and `result` panels: unchanged.

### 4. Quick Match integration — `src/app/38-0/team/page.tsx` + new watch route

- Extend `SingleMatchResult` (in `live-score.ts`) to also return `sim: MatchSim` ({h1,h2}).
  `resolveMatch` already builds it internally — just include it.
- Store `sim` on the local match (`LocalMatch` in `src/lib/draft/local.ts`) so the watch
  screen can play each half. Result page keeps reading `report` as today.
- `quickMatch()` (and the "Practice vs CPU" button) route to a new **`/38-0/match/watch`**
  screen instead of `/38-0/match/result`.
- **`/38-0/match/watch`** (new client route): local 30s ticker drives `progress`; plays
  h1 → a short half-time interstitial showing the H1 report → h2 → then
  `router.push("/38-0/match/result")` (unchanged result screen).

### 5. Tunables / config

`WATCH_CONFIG` (playback.ts) for half duration, commentary density, beat templates;
`LIVE_CONFIG.timers` for the live half phase length. Keep both in one place each.

## Data flow

- **Live:** phase machine enters `half1` → server writes `m.sim.h1` + half timer 30s →
  both clients read `secondsLeft` → `progress` → `watchFrame` → identical playback →
  deadline fires → `halftime_swap`. Same for `half2`.
- **Quick:** `resolveMatch` → `{ outcome, goals, pens, report, sim }` saved locally →
  `/38-0/match/watch` plays `sim.h1` then `sim.h2` via a local ticker → result page.

## Testing

- **Unit (`playback.test.ts`, node --test):**
  - Reveal is monotonic in `progress` (goals/stats never decrease).
  - At `progress = 1`: revealed goals == all half events; every stat == sim final total;
    feed contains every goal.
  - `scheduleBeats` is deterministic for a seed and never exceeds `count`.
  - Aggregate scoreline = priorGoals + revealed (half2 continues from half1).
- **Manual (preview):** seed a complete team, run guest Quick Match → watch a 30s half →
  goals land at their minute, scoreline pops, stats tick, commentary scrolls → half-time
  interstitial → 2nd half → result. Live two-player playthrough if a second session is
  available.

## Edge cases

- **0–0 half:** clock + ambient commentary still run; ends 0–0.
- **Clock skew / `secondsLeft` hits 0 early:** snap to `progress = 1` (final state).
- **Mid-half refresh (live):** `progress` derives from `secondsLeft`, so a late client
  resumes at the correct minute (past goals shown immediately).
- **Stat counts never exceed finals:** schedule length == final total by construction.

## Risks

- Spoiler-via-devtools during the 30s (accepted per Approach A).
- Longer match wall-time (live: +~46s vs today across both halves) — intended; it's the feature.
- Commentary volume must stay readable — cap beats/second via `WATCH_CONFIG`.

## Out of scope (follow-on)

- Async ranked + challenge-accept watch screens (server returns the report; would need
  `sim` in the response and the same `/match/watch` hand-off).
- Per-minute server-streamed reveal (Approach B) — not needed for a casual game.
