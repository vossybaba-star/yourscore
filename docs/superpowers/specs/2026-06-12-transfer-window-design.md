# 38-0 — The January Window (mid-season transfer window)

**Date:** 2026-06-12 · **Status:** Design approved in session, pending spec review
**Scope:** the 38-0 season sim (`/38-0/season`) — PL + La Liga, Classic + Expert, guests + signed-in.
**Out of scope:** World Cup Run (`wc.ts` path, untouched), Live H2H (has its own halftime subs), Quiz.

## 1. Feature summary

Every simulated season pauses at Matchweek 19 with a **Half-Term Report**: your real
record so far, your players' stats, and your January transfer budget — **the same flat
budget for every manager**. You may sign **up to 3** players from a spun market shortlist of 12, each
replacing a player in your XI, then the back 19 fixtures play out with the new team.
Sometimes (seeded-random) one of your XI is **injured** at the window and must be
replaced — the January handicap. One window per season, no reopening — like real
January. Window seasons count on the verified Leaderboard ✓ with a 🔁 badge.

Working name: **"The January Window"** (fallback: "Transfer Window").

## 2. Player flow

1. **MW 1–19** — first half simulates with the current reveal animation. Skip
   fast-forwards to MW19, not MW38. The pause happens for *every* season, including a
   guest's first (decision: no first-season skip; funnel cost is measured, not avoided).
2. **Half-Term Report** (new screen at MW19):
   - Record: W-D-L, points, GF/GA, position vs projection.
   - Player stats so far (top scorer / assister / clean sheets) — the deadwood-spotting data.
   - Budget line: "You have £50m to spend this January." (Same for everyone; the
     record/stats above inform *who* to swap, not *how much* you get.)
   - **Injury news** (when rolled, §3a): "❌ <Name> has been ruled out for the season —
     you must replace him in the window."
   - Buttons: **OPEN THE WINDOW →** / **Play on, no changes** ("Play on" is disabled
     while an injured player is unreplaced).
3. **The Window** — existing `Pitch` with the XI + the market shortlist of 12. To sign:
   pick a market player, pick the teammate he replaces (same-line rule via existing
   `canPlay`), pay the cost. Running budget bar, undo before confirm. **CONFIRM
   TRANSFERS** seals it.
4. **MW 20–38** — reverse fixtures with the new XI (new Strength, chemistry, formFactor).
5. **Final scorecard** — as today plus a transfers strip ("IN: Henry 91 ⇄ OUT: Crouch 78")
   and merged per-half player stats. Sold players keep their first-half stats.

**Expert mode:** market cards hide overall ratings (names + positions), but show costs in
budget points (accepted leak: cost 0 implies "not an upgrade").
**Guests:** full feature locally; sign-in only needed for leaderboard submission (unchanged).

## 3. Economy (existing metrics only — no new currency)

- **Budget** = `WINDOW_BUDGET` rating points, **flat for everyone** regardless of
  first-half performance (founder decision — one fair window, skill is in the spending).
  Starting value `WINDOW_BUDGET = 10` (£50m in the skin). It is the **tuning dial** —
  the calibration gate (§6) turns it, not formFactor.
- **Cost of a signing** = `max(0, incomingOverall − outgoingOverall)`. Sidegrades and
  downgrades are free. Sum of costs ≤ budget. UI presents cost as an **upgrade fee**
  (it varies with who you sell), themed in £m (×5 skin over rating points: "£75m budget").
- **Market shortlist** = 12 players, a **uniform seeded draw from the entire competition
  pool** — every player in the league dataset has a chance to appear (decision: no
  quality bands, no affordability guarantee; cold windows are part of the Spin identity).
  Composition: 1 GK + 3 defenders / 4 midfielders / 4 attackers (engine `posCategory`
  terms: 1 gk, 3 def, 4 mid, 4 att), de-duped against the XI and each other via existing
  `playerIdentity`.

### 3a. Injuries — the January handicap

- At MW19, a seeded-random roll (`INJURY_CHANCE = 0.30`, tuning dial) decides whether
  **exactly one** player from the XI (uniform pick across the 11) is ruled out for the
  rest of the season. Seeded by the season seed → same XI always produces the same
  injury outcome; players can't reroll it, and the server can reproduce it.
- An injured player **must be transferred out**. His replacement consumes one of the
  3 signing slots and follows normal cost rules (equal-or-worse cover is free, so a
  legal window always exists). The market's fixed composition (1 gk / 3 def / 4 mid /
  4 att) guarantees same-line cover for any injured position.
- The injured player keeps his first-half stats in the season totals (losing the
  Golden Boot leader at Christmas is the intended nightmare).
- v1 is 0-or-1 injuries; multi-injury windows are a future dial, not in scope.

## 4. Engine (`src/lib/draft/season.ts` restructure — Approach A, honest two-half sim)

- **Fixtures:** half 1 = each of the 19 opponents once, venue seeded per opponent;
  half 2 = the reverse fixture. (Replaces the current H-block/A-block single pass.)
- **RNG:** half 1 on `seededRng(seed)`; half 2 on `seededRng(seed + "‖" + sortedInIds)`
  (empty suffix when no transfers). Deterministic end-to-end: same XI + same signings →
  same season, forever, under the same engine version.
- **Dramatization:** `dramatizeOrder` applies within each half independently. Reveal
  order stays cosmetic, but half-1 *totals* (and therefore the budget) are real — the
  19 results shown before the window are exactly the 19 that were simulated, only their
  matchweek order is dramatic.
- **New shared-lib pure functions** (client and server run identical code):
  - `WINDOW_BUDGET` constant (no `transferBudget(points)` function — budget is flat)
  - `rollInjury(squad, seed): PlacedPlayer | null` — the §3a seeded injury roll
    (`INJURY_CHANCE` constant lives beside it)
  - `generateMarket(squad, league, half1Record, seed): PlayerSeason[12]`
  - `applyTransfers(squad, transfers, injured?): PlacedPlayer[]` — throws on wrong line
    (`canPlay`), off-market signing, duplicate identity, overspend, or an unreplaced
    injured player.
- `simulateSeason(squad, formation, strength, seed, opponents, transfers?)` — returns the
  existing `SeasonResult` shape plus a `window` block `{ budget, half1: {w,d,l,pts,gf,ga},
  signings: [{in, out, cost}] }`. Per-half player stats are computed with each half's
  actual squad and merged; clean sheets credited per half.
- **`ENGINE_VERSION = 2`** exported from `season.ts`.
- **Accepted break:** same-XI results change vs the v1 engine (fixture order + RNG draw
  order). Precedent: the 2026-06-12 formFactor recalibration. Old stored records stand;
  "replayable forever" becomes "replayable under the engine version that verified it"
  (hence `engine_version` on records, §5).

## 5. Verification & leaderboard (`/api/draft/records`)

- POST body gains optional `transfers: [{ out_slot, in_player_season_id }]`.
- Server chain (client result never read, as today): validate XI₁ → sim half 1 →
  **regenerate the market and re-roll the injury** → verify each signing is on the
  market, total cost ≤ `WINDOW_BUDGET`, and the injured player (if any) is among the
  outs → `applyTransfers` → validate + score XI₂ → sim half 2 → store. A no-transfer
  season with an unreplaced injured player is rejected.
- Record `seed` = `sortedXI₁ids ‖ sortedInIds` — same squad with different windows is a
  distinct record; identical replay is a no-op (`onConflict (user_id, seed)`, unchanged).
- **Migration (next after 31):** `draft_season_records` + `window_used boolean not null
  default false`, `transfers jsonb`, `engine_version int not null default 1` (existing
  rows backfill to 1; new writes set 2). Board API returns `window_used`; rows render a
  🔁 badge. Pure 38-0s keep undiluted bragging rights.
- **Known/accepted:** the window multiplies the deterministic brute-force surface
  (~10⁴ transfer combos per strong XI are scriptable). Accepted for v1 — same integrity
  model as re-spinning squads today. Lever if needed: daily cap on window-season submissions.

## 6. Calibration gate (blocks ship)

Extend `season.test.ts` to assert under the v2 engine:
- (a) random-team Invincible rate ≤ ~0.5% (today ~0.3%);
- (b) elite-XI (≈89.5+ Strength) no-window rate stays within the 10–15% band;
- (c) elite-XI **with greedy-optimal transfers** ≤ ~1.7× its no-window rate.
If (c) fails, tune `WINDOW_BUDGET` down. Exact thresholds re-confirmed
against the real saved-XI corpus during implementation (same method as the 06-12 pass).
The all-pool market (no guaranteed upgrades) and the injury handicap (30% of elite
seasons lose a starter at the window, often downgrading) are expected to do much of
the damping.

## 7. Client data & plumbing

- **Season cache:** `StoredSeason` (local.ts) gains `engineVersion`; cached v1 results
  are discarded and re-simulated. Cached seed must also incorporate the transfer set.
- **Analytics (funnel guard):** `trackGame` events `window_shown`, `window_opened`,
  `transfers_confirmed` (count + spend), `window_declined`; measure completion-to-share
  before/after release.
- **Share/OG:** `shareParams` gains a compact transfers param; OG card + share page render
  the IN/OUT strip; `xi` param carries the **final** XI.
- **Half-Term Report is shareable** (nice-to-have, v1.1): same OG pipeline, half-time card.

## 8. Risks (assessed in session, accepted with mitigations)

| Risk | Mitigation |
|---|---|
| 38-0 gets easier; June-12 calibration drifts | §6 calibration gate; `WINDOW_BUDGET` dial; all-pool market damping |
| Brute-force surface ×10⁴ per squad | Accepted v1; submission-cap lever documented (§5) |
| Funnel friction on the viral loop (pause in every season, incl. first) | Founder decision: no first-season skip; instrumented (§7) to measure |
| Drama arc weaker (honest first half) | Dramatize-within-half keeps run-in tension |
| Flat budget hands elite teams the same power as strugglers | Accepted — fairness is the point; §6(c) guards the Invincible rate |
| Client/server lockstep (5-step verify chain) | All steps are shared-lib pure functions; `engine_version` on records |
| Delta pricing unintuitive | UI language: "upgrade fee", £m skin |
| La Liga pool depth for market draw | Check at implementation; quotas degrade gracefully if a line is thin |

## 9. Testing

- **Unit:** market determinism, composition (1 gk / 3 def / 4 mid / 4 att),
  all-pool reachability, de-dupe; injury roll determinism + ~30% rate + uniform pick +
  guaranteed same-line market cover; `applyTransfers` rejections (wrong line, off-market,
  duplicate, overspend, unreplaced injured player).
- **Sim:** determinism with/without transfers; per-half stats sum to season totals;
  reverse-fixture integrity (each opponent exactly twice, venues opposite).
- **Calibration:** §6 gate.
- **Route:** integration — fabricated / off-market / overspent transfers rejected;
  valid window season verifies and stores `window_used`, `transfers`, `engine_version=2`.
- Existing `season.test.ts` expectations re-baselined to v2.

## 10. Acceptance criteria

1. Every non-WC season pauses at MW19 with the Half-Term Report; "Play on" reaches the
   final scorecard in one tap — unless an injury forces a replacement first.
2. Up to 3 signings, market of 12 drawn from the whole pool, flat `WINDOW_BUDGET`
   (start: 10 / £50m) for every manager, cost = positive overall delta, same-line
   swaps only.
3. Same XI + same signings reproduce the identical season; server verifies window
   seasons end-to-end and never trusts the client result.
4. Window seasons appear on Leaderboard ✓ with 🔁; pure seasons unmarked.
5. Calibration gate green before merge.
6. YOURSCORE.md updated (new mechanic + engine v2 note) in the shipping session.
