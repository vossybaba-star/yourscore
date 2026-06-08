# 38-0 Live Multiplayer — Implementation Plan

**Spec:** [`2026-06-08-38-0-live-multiplayer-design.md`](./2026-06-08-38-0-live-multiplayer-design.md)
**Branch:** `38-0-live-multiplayer`
**Date:** 2026-06-08

Built bottom-up: pure/testable engine first, then backend state machine, then matchmaking,
then the realtime UI, then standings + bot disguise + edge handling. Each phase ends at a
**verification gate** so it can be checked before the next phase depends on it. Additive
only — no existing 38-0 schema, routes, or scoring behaviour changes (except the additive
`draft_standings` draws/points and the `draft_matches` two-half columns).

---

## Phase 0 — Migration & types

1. `supabase/migrations/18_draft_live.sql`:
   - `draft_live_matches`, `draft_live_queue` (schema per spec §5) + RLS (participants-only
     SELECT/UPDATE).
   - Atomic pairing function `draft_live_pair(p_user uuid, p_ranked bool, p_league uuid)`
     using `FOR UPDATE SKIP LOCKED`; returns a match row or enqueues + returns null.
   - Alter `draft_matches`: add `challenger_goals int`, `opponent_goals int`, `detail jsonb`.
   - Alter `draft_standings`: add `draws int not null default 0`.
   - Extend the daily-reset function to mark matches stuck past a hard timeout as
     `abandoned`.
2. Extend `src/types/draft-db.ts` with the new tables/columns (shim until `database.ts`
   regen).

**Gate:** migration applies cleanly to a scratch DB; types compile.

---

## Phase 1 — Engine additions (pure, unit-tested)

In `src/lib/draft/live-score.ts` (new, pure, type-strippable for `node --test`):

1. `resolveHalfGoals(strengthA, strengthB, rng)` → `{ a, b }` Poisson split via
   `winProbability` + tuned `XG_PER_HALF`.
2. `resolveShootout(strengthA, strengthB, rng)` → `{ a, b }` near coin-flip with slight lean.
3. `aggregate(h1, h2)` → `{ a, b, level }`.
4. `LIVE_CONFIG` — all timers + `XG_PER_HALF` + swap budgets in one place.
5. Pure phase-transition helper `nextPhase(state, now)` → next phase (no I/O), so the guard
   is unit-testable and idempotent.

**Gate:** extend `scripts/draft/run-tests.sh` — stronger side wins more, upset band correct,
level routes to draw decision, shootout ~50/50, `nextPhase` idempotent. All green.

---

## Phase 2 — Match lifecycle backend

`src/lib/draft/live-server.ts` + routes under `src/app/api/draft/live/`:

1. `GET /api/draft/live/[id]` — authoritative state read (participant-gated).
2. `POST /api/draft/live/ready` — set ready; conditional advance.
3. `POST /api/draft/live/swap` — validate phase/budget/deadline + player legality
   (`canPlay`, real pool player), apply, recompute Strength via `scoreTeam`, decrement budget.
4. `POST /api/draft/live/advance` — idempotent transition (`WHERE phase = $expected`);
   resolves `half1`/`half2` goals server-side, runs `draw_decision`/`penalties` branch,
   finalizes `result` (insert `draft_matches`, `creditResult`, `applyTeamResult`, league
   credit).
5. `creditResult(win|draw|loss)` replaces `creditWin` in `server.ts` (keep a thin
   `creditWin` shim if referenced elsewhere).

**Gate:** integration test the full phase sequence (both branches: penalties + accepted
draw) and the three swap rejections (illegal / over-budget / past-deadline) by driving the
endpoints directly.

---

## Phase 3 — Matchmaking

1. `POST /api/draft/live` — `create` / `join` / `queue` / `cancelQueue`; `queue` calls
   `draft_live_pair`.
2. Bot fallback: after a randomized ~15–20s wait with no pair, create an `is_bot` match
   with a `seededBot` opponent and a **realistic display name** (new generator, separate
   from the jokey `OPPONENT_NAMES`).

**Gate:** concurrent `queue` calls never double-match (test against the pairing function);
bot fallback produces a playable match credited to ranked standings.

---

## Phase 4 — Realtime client + match UI

1. `useLiveMatch(matchId)` hook — subscribe to `draft:match:<id>`
   (`postgres_changes` + `presence` + `broadcast`), expose phase/state/countdown, fire
   `/advance` at the local deadline.
2. Routes: `/38-0/live` (entry), `/38-0/live/[code]` (friend join),
   `/38-0/live/match/[id]` (the phase-driven match screen reusing `Pitch.tsx` + spin sheet).

**Gate:** preview tool, two browser sessions — full friend-code match start to finish,
reveal → swaps → halves → result, with live sync.

---

## Phase 5 — Standings & leaderboard (draws + points)

1. Standings reads/writes use points (W=3, D=1) + wins tiebreak.
2. Leaderboard UI (`/38-0/leaderboard`, league boards) shows **W–D–L + Pts**.

**Gate:** a drawn ranked match increments `draws` and points correctly and renders on the
board.

---

## Phase 6 — Bot disguise & edge handling

1. Bot acts on **human-like delays** for ready / swaps / `draw_decision` (no instant
   resolution), driven server-side at advance time using the match's stored timing.
2. Disconnect: presence-leave UI ("opponent disconnected…"); deadlines still advance the
   match. Reconnect refetches `GET` + resubscribes.
3. Verify the cron reaper clears abandoned matches.

**Gate:** a bot match is indistinguishable from a human one in the UI; a mid-swap
disconnect does not stall; an abandoned match is reaped.

---

## Phase 7 — Hardening & docs

1. Rate-limit the live endpoints (mirror `rateLimitDistributed` on `/match`).
2. Full manual pass: friend code, random queue, bot fallback, draw→penalties,
   draw→accepted, disconnect/reconnect.
3. Update `DRAFT-XI.md` (live mode section) and `YOURSCORE.md` if the live mode changes any
   locked product description; run `graphify update .`.

**Gate:** typecheck + all tests green; manual checklist complete.

---

## Suggested PR slicing

- PR 1: Phases 0–1 (migration + engine + tests) — no user-facing change, low risk.
- PR 2: Phases 2–3 (backend + matchmaking) — behind no UI yet.
- PR 3: Phase 4 (realtime UI) — the playable feature.
- PR 4: Phases 5–7 (standings, bot disguise, hardening, docs).
