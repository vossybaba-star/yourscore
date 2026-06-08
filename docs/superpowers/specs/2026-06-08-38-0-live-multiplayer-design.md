# 38-0 Live Multiplayer — Design Spec

**Date:** 2026-06-08
**Game:** 38-0 (codename "Draft XI"), route `/38-0` — a separate competitive football
team-builder game inside YourScore (not part of the quiz modes).
**Status:** Design approved; pending implementation plan.

> Vocabulary note: this game predates the YourScore "Lobby" rename and has its own
> surface. "Lobby" here means the 38-0 live match waiting room, not the quiz `rooms`
> tables.

---

## 1. Goal

Replace the current "multiplayer" — which is an **asynchronous Strength-rating compare**
(`resolveH2H(myStrength, oppStrength, seededRng)` against a random saved team snapshot or
a bot) — with a **live, simultaneous, two-half head-to-head** where both players are
present and make tactical changes between phases.

### The match, end to end
1. **Pre-game:** each player sees the opponent's XI, then may make **1** change.
2. **First half:** resolved into goals.
3. **Halftime:** each player may make **2** changes.
4. **Second half:** resolved into goals.
5. **Result:** aggregate score decides it; a level aggregate may go to **opt-in penalties**.

A "change" is **spin & choose**: the player picks a slot, spins once, and chooses one of
the revealed candidates or cancels (cancel costs nothing — no spin-fishing).

---

## 2. Architecture (approved: Approach A)

YourScore runs on serverless (Next.js on Vercel) — there is no always-on game server to
tick a timer to zero. So the match is a **server-authoritative state row advanced by
guarded, idempotent client-triggered transitions**, synced over Supabase Realtime.

- One `draft_live_matches` row is the **source of truth**: current phase, phase deadline,
  both squads + Strengths, swap budgets, per-half goals, penalties, winner.
- Each phase carries a server-set `phase_deadline`. Clients count down to it locally.
- Transitions go through one idempotent endpoint (`POST /api/draft/live/advance`) that
  advances **only when both players are ready OR the deadline has passed**. Both clients
  ping it; the first call wins via a conditional update (`WHERE phase = $expected`), the
  rest no-op.
- Half goals are computed **server-side** with a seeded RNG keyed on `matchId:half` —
  reproducible, auditable, and impossible to precompute (the matchId is minted at match
  start). Same authoritative pattern as today's scoring.
- **Sync:** Supabase Realtime channel `draft:match:<id>` — `postgres_changes` on the row
  drives re-render (phase/score/squad), `presence` tracks who is online, `broadcast`
  powers ephemeral niceties ("opponent is choosing…"). This mirrors the proven live-quiz
  lobby pattern in `src/app/play/[roomId]/page.tsx`.
- **Backstop:** the existing daily-reset `pg_cron` job is extended to reap matches stuck
  in one phase past a hard timeout — no new infrastructure.

**Rejected alternatives:** (B) a pg_cron/edge ticker as the primary authority — pg_cron's
~1-minute floor is too coarse for 15–35s phases; kept only as the abandoned-match reaper.
(C) pure client-coordinated broadcast — no authority, so desync and trivial cheating;
unacceptable for a ranked ladder.

---

## 3. Phase state machine

The row advances through this sequence. Both clients render whatever phase the row is in;
the server owns every transition. Timers are constants in one config file, tunable after
playtesting.

| Phase | What happens | Timer (initial) |
|---|---|---|
| `lobby` | Both joined; both tap Ready | until both ready |
| `reveal` | Both XIs shown side-by-side, Strengths revealed | ~5s auto |
| `pregame_swap` | Each player may make **1** change | 25s |
| `half1` | Server resolves first-half goals; clients play a short reveal | ~7s |
| `halftime_swap` | Each player may make **2** changes; running score shown | 35s |
| `half2` | Server resolves second-half goals | ~7s |
| `draw_decision` | *(only if aggregate is level)* each player picks Penalties or Take-the-draw | timed; default = take the draw |
| `penalties` | *(only if both opted in)* seeded shootout | ~7s |
| `result` | Aggregate score, winner or draw, standings credited | — |

**Transition rule:** a phase ends when **both players confirm/ready OR the deadline
passes**, whichever is first. A player who does nothing in a swap window keeps their
current XI. A player who does nothing in `draw_decision` is treated as *take the draw*.

---

## 4. Goals & penalties model

Reuses the existing scoring primitives in `src/lib/draft/score.ts`; no new scoring math is
invented.

- After each swap window the server **recomputes each side's Strength** with `scoreTeam`.
  Half 1 uses the post-pregame XI; half 2 uses the post-halftime XI. This is precisely
  what lets a halftime double-swap change the game.
- Per half, **total expected goals** is a tuned constant (≈1.4 per half → realistic ~2.8
  per match). It is split by `winProbability(a, b)`: the stronger side gets the larger
  share. Each side's goals are a **Poisson draw** seeded on `seededRng(matchId + ":h" + n)`.
- Variance is real: a 55-Strength minnow can still nick one off a 90 — upsets happen, by
  design, matching the existing single-game upset intent.
- The two halves aggregate into the final score.

### Draws & penalties (opt-in — no game is forced to penalties)
- If the aggregate is **level**, the match enters `draw_decision`.
- Each player chooses **Penalties** or **Take the draw** (timed; no response = take the
  draw).
- **Both** opt in → `penalties`: a **seeded shootout**, near coin-flip with only a slight
  Strength lean (penalties should feel like a lottery) → `result`.
- **Either** declines or times out → `result` **stands as a draw**.
- This applies to ranked too: **ranked matches can end in a draw.**

### Swap mechanic detail
- Opening a change **spins once** and shows candidates; the player picks one **or** cancels.
- Picking consumes the change and recomputes Strength; cancelling consumes nothing.
- Each change targets one slot; halftime's two changes may hit two slots or be spent
  however the player likes.
- Spin is client-side from the dataset (as in the existing draft); the **server validates
  legality** — the chosen player must be a real pool player and `canPlay(slot)` — and that
  a change is available and the deadline has not passed. The integrity boundary is "is the
  XI a legal set of real players", consistent with the existing trust model (the server
  recomputes Strength and never trusts a client-sent rating; it does not verify spin
  provenance).

---

## 5. Data model

New working-state tables; the permanent record and standings reuse the existing
`draft_matches` / `draft_standings` rails. **Migration: `supabase/migrations/15_draft_live.sql`.**

### `draft_live_matches` (ephemeral match state)
- `id uuid pk`, `phase text`, `phase_deadline timestamptz`, `created_at`, `updated_at`,
  `resolved_at`
- `join_code text` (6-char, friend lobbies), `ranked bool`, `league_id uuid null`,
  `is_bot bool`
- `p1_id uuid`, `p2_id uuid null` (null until joined; null + `is_bot` for a bot),
  `p1_ready bool`, `p2_ready bool`
- current XI per side (updated as swaps land): `p1_squad jsonb`, `p1_formation text`,
  `p1_strength numeric`, and `p2_*` equivalents
- swap budgets: `p1_pregame_left int`, `p1_half_left int`, and `p2_*` equivalents
- per-half goals: `h1_p1 int`, `h1_p2 int`, `h2_p1 int`, `h2_p2 int` (null until resolved),
  `pens_p1 int null`, `pens_p2 int null`
- `winner_id uuid null` (null = draw)

### `draft_live_queue` (random-queue waiting room)
- `user_id uuid pk`, `enqueued_at timestamptz`, `ranked bool`, `league_id uuid null`

### Atomic pairing function
- A `SECURITY DEFINER` Postgres function pairs the oldest waiter using
  `SELECT … FOR UPDATE SKIP LOCKED`, so two players cannot double-match. If no waiter
  exists, the caller is enqueued.

### Changes to existing tables
- `draft_matches` (permanent record): add `challenger_goals int`, `opponent_goals int`,
  and `detail jsonb` (per-half breakdown, penalties) for the two-half record.
- `draft_standings`: add **`draws int`**; the ladder ranks by **points (Win = 3, Draw = 1)**
  then wins as a tiebreak. The win-only helper `creditWin` becomes
  `creditResult(win | draw | loss)`.

### RLS
- Only the two participants may `SELECT`/`UPDATE` their `draft_live_matches` row (so
  `postgres_changes` works for both). All meaningful mutations go through service-role
  endpoints that validate authoritatively.

---

## 6. API surface

All under `src/app/api/draft/live/`.

- `POST /api/draft/live` — `{ action: 'create' | 'join' | 'queue' | 'cancelQueue',
  code?, leagueId?, ranked? }`.
  - `create` → new match with a `join_code`, `p1 = me`, phase `lobby`.
  - `join` → find match by code, set `p2 = me`.
  - `queue` → run the atomic pair-or-enqueue function; returns a match or "waiting".
  - `cancelQueue` → remove self from the queue.
- `POST /api/draft/live/ready` — `{ matchId }`; marks ready; advances if both ready.
- `POST /api/draft/live/swap` — `{ matchId, slotId, newPlayer }`; validates phase ∈ swap
  windows, budget > 0, deadline not passed, and `newPlayer` legality; applies it,
  recomputes Strength, decrements budget.
- `POST /api/draft/live/advance` — **idempotent** transition guarded by a conditional
  update (`WHERE phase = $expected`). On entering `half1`/`half2` it resolves goals; on
  `result` it finalizes: insert `draft_matches`, `creditResult` + `applyTeamResult`,
  league credit.
- `GET /api/draft/live/[id]` — full state for initial load / reconnect.

---

## 7. Matchmaking & bots

- **Friend lobby:** `create` → share `yourscore.app/38-0/live/<code>` (mirrors the existing
  challenge-link pattern).
- **Random queue:** waiting screen; if no human pairs within a **slightly randomized**
  ~15–20s wait, a **`seededBot`** match is created.
- **Bots rank and are disguised as real players** (so the ladder always feels populated):
  - Queue bot-fallback matches **credit the ranked ladder** exactly like human matches
    (`creditResult` + standings).
  - Bots are presented as **ordinary players**: a realistic display-name generator is used
    for ranked bots (the jokey `OPPONENT_NAMES` set in `opponent.ts` stays only for explicit
    Quick Match / practice). **No "bot" label anywhere** in the live UI.
  - The bot "spends" its swap windows and `draw_decision` choice on **human-like delays /
    probabilities** rather than resolving instantly, so its timing and choices read as a
    real person's.

---

## 8. Realtime, timers, disconnect

- Channel `draft:match:<id>`: `postgres_changes` on the row drives re-render; `presence`
  tracks both online; `broadcast` powers "opponent is choosing…".
- **Timers:** client counts down to `phase_deadline`; at zero it calls `/advance`. Both
  clients call — idempotency makes that safe.
- **Disconnect:** presence-leave shows "opponent disconnected…"; the match still advances
  on deadlines (the absent player keeps their current XI), so a drop never stalls the game.
- **Reconnect:** refetch `GET /api/draft/live/[id]` + resubscribe; the stored
  `phase_deadline` resyncs the countdown.
- **Abandoned matches** (stuck in one phase past a hard timeout) are reaped by the extended
  daily-reset `pg_cron` job.

---

## 9. UI / route surface

- `/38-0/live` — entry: "Play a friend" (create/share code) vs "Find a match" (queue).
- `/38-0/live/<code>` — friend join page.
- `/38-0/live/match/<id>` — the live match screen: a single client component driven by the
  phase machine, rendering each phase (reveal, swap windows with a spin sheet + countdown,
  half reveals, draw decision, penalties, result). Reuses `Pitch.tsx` and the existing spin
  UI.
- The result reuses the existing shareable result graphic (`/api/draft/og`) where it fits.
- Leaderboard UI updates to show **W–D–L + Pts** (from the new `draws`/points model).

---

## 10. Testing

- **Unit** (extend `scripts/draft/run-tests.sh`, `node --test`):
  - Seeded goals model — stronger side wins more often; upset rate stays in the intended
    band; level aggregate routes to the draw decision.
  - Penalty shootout is near coin-flip with a slight Strength lean.
  - Pure phase-advance guard logic is idempotent (same input twice = one transition).
- **Integration:**
  - `/advance` produces the correct phase sequence, including the draw → penalties and
    draw → accepted-draw branches.
  - `/swap` validation rejects an illegal player, an over-budget change, and a past-deadline
    change.
  - The atomic pairing function never double-matches under concurrent `queue` calls.
- **Manual:** two browser sessions via the preview tool — friend-code flow, random queue,
  bot fallback (verify it reads as a real opponent), and a disconnect mid-swap.

---

## 11. Out of scope (this spec)

- Spectating / watching a friend's live match.
- Tournaments / brackets.
- Voice or chat in the lobby.
- Reworking the existing async challenge flow (`/api/draft/challenge`) — it stays as-is for
  now; this spec adds the live mode alongside it.
