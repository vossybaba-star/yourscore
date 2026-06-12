# Implementation plan — 38-0 January Window

**Spec:** `docs/superpowers/specs/2026-06-12-transfer-window-design.md` (approved 2026-06-12)
**Order matters:** each phase lands green (build + tests) before the next starts. The
engine phase is the foundation; UI and verification both consume it.

## Phase 1 — Engine (pure TS, no UI, no API)

**New file `src/lib/draft/window.ts`** — the window's pure logic, shared client/server:
- `WINDOW_BUDGET = 10`, `INJURY_CHANCE = 0.30`, `MARKET_SIZE = 12`,
  `MARKET_SHAPE = { gk: 1, def: 3, mid: 4, att: 4 }`, `MAX_SIGNINGS = 3` — all exported
  tuning dials with doc comments.
- `signingCost(incoming, outgoing): number` = `max(0, in.overall − out.overall)`.
- `rollInjury(squad, seed): PlacedPlayer | null` — `seededRng(seed + "‖inj")`, roll vs
  `INJURY_CHANCE`, uniform pick across the 11.
- `generateMarket(squad, league, seed): PlayerSeason[]` — `seededRng(seed + "‖mkt")`,
  uniform draw per `posCategory` quota from `pool.ts` league players, de-duped against
  the XI and each other via `playerIdentity`. Degrade gracefully if a line is thin
  (backfill from other lines, keep 12 total).
- `type Transfer = { outSlot: string; in: PlayerSeason }` and
  `applyTransfers(squad, transfers, market, injured): PlacedPlayer[]` — validates
  ≤ `MAX_SIGNINGS`, signing ∈ market, same-line `canPlay`, no duplicate `playerIdentity`,
  Σcost ≤ `WINDOW_BUDGET`, injured player (if any) among the outs. Throws typed errors.

**`src/lib/draft/season.ts` restructure (engine v2):**
- `export const ENGINE_VERSION = 2`.
- Fixture model: half 1 = 19 opponents once each, venue per opponent from the half-1
  RNG; half 2 = reverse fixtures.
- `simulateSeason(squad, formation, strength, seed, opponents, window?)` where
  `window = { transfers, injured }` (optional, absent = plain season). Half-2 RNG =
  `seededRng(seed + "‖" + sortedInIds)`. Squad₂ strength/chemistry/formFactor recomputed
  via `scoreTeam`.
- Per-half goal/assist/clean-sheet distribution using each half's squad; merged totals;
  sold players retain half-1 stats. `dramatizeOrder` per half.
- Result gains `window: { budget, half1: {w,d,l,pts,gf,ga}, injured: name|null,
  signings: [{in, out, cost}] } | null`.

**Tests:**
- New `window.test.ts`: cost fn; injury determinism/rate/uniformity; market determinism,
  shape, de-dupe, thin-pool fallback; every `applyTransfers` rejection; same-line cover
  guarantee for any injured position.
- `season.test.ts` re-baseline + new: determinism with/without transfers; per-half stats
  sum to totals; reverse-fixture integrity; **calibration gate** — (a) random-team
  Invincible ≤ ~0.5%, (b) elite no-window 10–15%, (c) elite + greedy-optimal window
  ≤ 1.7× (b). Tune `WINDOW_BUDGET` if (c) fails.
- Run via existing `node --test` setup (files are type-strippable — no enums).

## Phase 2 — Client flow (`/38-0/season`)

- **State machine in `src/app/38-0/season/page.tsx`:** `half1-reveal → report → window?
  → half2-reveal → final`. Skip targets the current half's end. Sim is invoked twice:
  half 1 first (squad only), full result once window choices are known.
- **New `src/components/draft/MidSeasonReport.tsx`:** record vs projection, top-scorer/
  assister/clean-sheet stats, £50m budget line, injury news, OPEN THE WINDOW / Play on
  (disabled while injured player unreplaced).
- **New `src/components/draft/TransferWindow.tsx`:** existing `Pitch` + market list of
  12; tap market player → eligible outgoing teammates highlighted (`canPlay`); running
  budget bar (£m skin, ×5); undo; CONFIRM TRANSFERS. Expert mode: hide overalls, show
  £m costs.
- **`src/lib/draft/local.ts`:** `StoredSeason` gains `engineVersion` + window payload;
  discard cached v1 results; cache key incorporates transfer ids.
- **Analytics (`trackGame.ts`):** `window_shown`, `window_opened`, `transfers_confirmed`
  (count + spend + injured flag), `window_declined`.
- **Share/OG:** `shareParams` adds compact transfers + injury params; `xi` = final XI;
  OG card + `/38-0/season/share` render the IN/OUT strip.

## Phase 3 — Verification & leaderboard

- **Migration `35_window_records.sql`:** `draft_season_records` + `window_used boolean
  not null default false`, `transfers jsonb`, `engine_version int not null default 1`;
  backfill existing rows to 1. Apply via linked Supabase CLI **after founder approval**
  (per project norm).
- **`/api/draft/records` POST:** accept optional `transfers`; server chain per spec §5
  (re-roll injury, regenerate market, validate, sim both halves); reject unreplaced
  injury; store `window_used`, `transfers`, `engine_version = ENGINE_VERSION`; record
  seed = `sortedXI₁ids ‖ sortedInIds`.
- **Board UI:** records API returns `window_used`; leaderboard rows show 🔁 badge.
- **Tests:** route integration — off-market / overspend / unreplaced-injury rejected;
  valid window season stored with correct fields; identical replay no-op.

## Phase 4 — Calibration, QA, ship

- Run the saved-XI corpus through engine v2 (same method as the 06-12 formFactor pass);
  confirm gate thresholds; tune `WINDOW_BUDGET` / `INJURY_CHANCE` if needed.
- Manual QA: guest first season, Expert window, injured-GK path, cold-market path,
  La Liga pool depth, share cards.
- Update `YOURSCORE.md` (§5B: January Window mechanic, engine v2 note, vocabulary:
  "Mid-Season Report", "January Window") + bump Confirmed date; `graphify update .`.
- Watch funnel events for completion-to-share movement post-release.

## Explicitly out of scope (v1)

Multi-injury windows · shareable Mid-Season Report card (v1.1) · submission caps for
window seasons (documented lever) · World Cup Run · Live H2H.
