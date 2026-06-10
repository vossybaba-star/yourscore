# 38-0 — 2D pitch view: a fast-forward highlight reel

**Date:** 2026-06-10
**Status:** Built — verified in preview, ready to ship

## Context

The shipped "Watch the Half" screen plays each half over real seconds as a clock +
scoreline + ticking stat bars + a **text commentary feed** (`MatchWatch.tsx`, driven by the
pure `playback.ts`). We replace the text feed with **the football itself** — a Championship-
Manager-style 2D pitch with moving dots and a ball — because watching the match read better
than reading about it.

**Hard constraint:** the engine has **no spatial data**. A `HalfSim` is only a goal-event
timeline (`minute`/`side`/`scorer`) + final stat totals. A real tactical sim was rejected
(weeks of work; would supplant the unified result engine). This is a **choreographed
presentation layer**: 22 dots + a ball *puppeteered* over the existing timeline. No outcome,
server, or DB change.

## Decisions (locked with the user)

- **2D pitch, all 22 players AND the ball move.** Dots are formation anchors that lean toward
  the ball (role-weighted), the possessing side pushes up / defending side drops, plus light
  idle wobble — not a lone ball among statues.
- **Fast-forward HIGHLIGHT REEL, not linear playback.** A half is a short window, so the clock
  **spins between moments** and **slows to watchable speed on each key beat** (a chance or a
  goal), where the dots play buildup → strike → outcome. Every time the dots are on screen,
  something is happening.
- **Possession bias.** The higher-possession side spends open play in the opponent's half.
- **The pitch replaces the text feed entirely.** View = pitch + scoreline/clock + stat bars.
- **45 seconds per half** (up from 30) — more room for the reel.

## Components

### 1. Playback core — `src/lib/draft/pitch.ts` (new, pure, seeded, `node --test`able)
- `buildReel(sim, half, matchId)` selects beats — every goal (always), then top on-target
  chances, then a corner; tops up to `minBeats` with ambient half-chances so a 0–0 is never
  empty; caps at `maxBeats`. Builds a piecewise **progress→minute remap**: short fast-forward
  *skips* between *dwell* windows, allocated in progress-space by weight (so it's independent
  of the real-seconds budget). Monotonic; starts at 0, ends at 45.
- `pitchFrame(sim, half, matchId, progress)` returns `{ matchMinute, ball, players[22], beat?,
  speed, goalsA, goalsB }` — ball choreographed up the channel and struck at goal during a
  dwell, raced (possession-biased) during a skip; players from a 4-3-3 anchor table leaning to
  the ball with team push + wobble; all coords clamped to `[0,1]`.
- Reuses `seededRng` (`score.ts`), `scheduleBeats` (`playback.ts`), `slotsFor` (`formations.ts`).

### 2. `<MatchPitch>` — `src/components/draft/MatchPitch.tsx` (new, drop-in for MatchWatch)
Same props as the old `MatchWatch`. Canvas 2D on a `requestAnimationFrame` loop with an
**eased internal clock** that chases the injected `progress`, so motion stays smooth between
the caller's coarse updates. Draws turf + markings, 22 dots (ME green / OPP red), the ball,
and beat flourishes (strike streak, goal net-flash + celebration ring). The scoreline/clock
header and stat bars are React overlays (shared `MatchHud.tsx`), updated only when an integer
changes. Pauses on hidden tab; honours `prefers-reduced-motion`.

### 3. Shared HUD — `src/components/draft/MatchHud.tsx` (new)
`ScoreHeader` + `StatBars`, lifted out of the deleted `MatchWatch.tsx`.

### 4. Integration
- Quick Match `…/match/watch/page.tsx` and live H2H `…/live/match/[id]/page.tsx`: swap
  `<MatchWatch>` → `<MatchPitch>` (identical props).
- `WATCH_CONFIG.halfSeconds` 30→45 and `LIVE_CONFIG.timers.half1/half2` 30→45; the live page's
  `progress` divisor now derives from `WATCH_CONFIG.halfSeconds`.
- `watchFrame` now clamps on-target ≤ shots while ticking (both still reach their real finals)
  — previously they ticked independently and on-target could briefly exceed shots on the HUD.
- `MatchWatch.tsx` deleted (no importers).

## Testing
- **Unit (`pitch.test.ts`):** reel includes every goal; `maxBeats`/`minBeats` honoured; remap
  monotonic, starts at 0, ends at 45/90; segments tile `[0,1]`; all coords in `[0,1]`;
  possession bias (dominant side's open-play ball in the opponent half); a goal beat resolves
  to the scoring side at its goal; goals monotonic and equal sim finals at progress 1;
  deterministic for a seed. 77/77 draft tests green; `tsc --noEmit` + `next build` clean.
- **Preview (mobile):** seeded Quick Match → pitch renders both XIs, dots flow as a unit toward
  play, clock fast-forwards between moments, the 12' goal pops 1–0, possession eases to 60/40
  with the dominant side camped forward, stats consistent, no console errors.

## Risks / notes
- Motion is representational, not tactical — accepted; possession bias + highlight pacing carry
  the realism for a casual game.
- Spoiler-via-devtools during the half persists (same as before) — accepted.
- `PITCH_CONFIG` (maxBeats, dwell/skip weights, possessionBias, jitter, roleAttract) makes
  pacing/feel easy to dial after playtest.
