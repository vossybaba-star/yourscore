# 38-0 — Switch player positions while drafting

## Problem

While building a Draft XI, a user can place each spun player into a slot, but once
placed they can't **rearrange** the XI. If they draft a striker into the ST slot and
later want them on the wing (or want to swap two midfielders around), the only tools
today are destructive: clear a slot and re-spin (`/38-0/swap`), or the constrained
pre-match swap windows. There's no way to simply **move a player you already have to
another position they can play**.

The user's ask: *"As the user is selecting their team or their draft across all games,
they should be able to switch positions of the players they're drafting at any point …
based on the positions that each player can play in."*

## Decisions (locked with the user)

1. **Eligibility = same-line only.** A player can move to any slot in their own line:
   a striker among ST/RW/LW, a central mid among CDM/CM/CAM, a defender among the
   back-line slots, GK among GK. This reuses the existing `canPlay` (category-based)
   model **unchanged** — no edit to `score.ts`, the spin pool, or server validation.
   Cross-line moves (e.g. striker → CAM) are out of scope.
2. **Occupied target → swap.** Moving a player onto a filled slot swaps the two
   players. Because eligibility is category-based, a key invariant holds:

   > If player A is eligible for slot S_B (same category as S_B), and player B
   > currently occupies S_B, then B is the same category as A, and A's current slot
   > S_A is also that category — so **B is always eligible for S_A**. A same-line swap
   > is therefore *always legal both ways*.

   The "displaced player can't play the vacated slot" fallback the user mentioned can
   never actually arise under same-line rules, so swaps are always clean and
   non-destructive. (We still guard defensively.)
3. **Non-destructive & anytime.** No re-spin, no player lost, no count limit. Strength
   and line ratings recompute immediately; the team persists via `saveTeam`.

## Scope — surfaces

Position-switching is added to the three surfaces where a user **builds or selects** a
`LocalTeam` (localStorage-backed):

- **`/38-0/play`** — Premier League Draft XI loop (during drafting).
- **`/38-0/wc`** — World Cup Run draft (during drafting).
- **`/38-0/team`** — the XI review screen. This feeds Quick Match, live H2H
  matchmaking, challenges, and WC start — all submit `team.squad` — so the arrangement
  fixed here flows downstream into every game automatically.

**Out of scope (deliberate):** the live H2H *in-match* swap window and the WC-Run
*upgrade* slot. Those are server-authoritative mid-competition mechanics with their own
limited rules (replace-a-player, capped count); free rearranging there is a separate
change needing a server endpoint. The arrangement the user locks on `team` is what they
carry into those flows, so "selecting your team" is fully covered.

## Design

### 1. Pure logic — `src/lib/draft/local.ts`

Two new pure helpers (no localStorage; unit-testable):

```ts
/** Slots a placed player can move into — every slot in their own line except the
 *  one they already occupy (filled or empty; filled ⇒ a swap). null player ⇒ []. */
export function movableSlots(team: LocalTeam, slotId: string): Slot[]

/** Move the player in `fromSlotId` to `toSlotId`, recompute, return a new team.
 *  - If `toSlotId` is empty: relocate (player keeps card, slotPos updates).
 *  - If `toSlotId` is filled: swap the two players' slots.
 *  Guards: no-op if no player in fromSlot, if from===to, or if the move is not
 *  same-line legal (canPlay). Defensive: if a swap would leave the displaced player
 *  in an illegal slot (can't happen under same-line rules), the move is refused. */
export function movePlayer(team: LocalTeam, fromSlotId: string, toSlotId: string): LocalTeam
```

`movePlayer` rebuilds `squad` with the two affected `PlacedPlayer` entries reassigned
(`slot` + `slotPos` updated to the destination slot's), then calls the existing
`recompute(team)` so `strength`, `projected`, and line ratings stay correct.

### 2. Component — extend `Pitch.tsx` + new `EditablePitch.tsx`

**`Pitch.tsx`** gains two *optional, backward-compatible* props (existing callers
unaffected):
- `eligibleSlots?: Set<string>` — slot ids to render as valid move targets (ring/glow).
- `selectedSlot?: string | null` — the picked-up player's slot (distinct "lifted"
  styling). `highlightSlot` stays for the existing single-highlight callers.

**`EditablePitch.tsx`** (new, `"use client"`) wraps `Pitch` and owns the move-mode
interaction so each page stays thin:

```ts
EditablePitch({
  formation, squad, compact, hideOverall,
  onMove: (fromSlotId: string, toSlotId: string) => void, // page persists
})
```

Behaviour (internal `movingFrom` state):
- Tap a **filled** slot → pick that player up (`movingFrom = slotId`); its eligible
  targets (via `movableSlots`) light up.
- With a player picked up:
  - tap an **eligible** slot → `onMove(movingFrom, slotId)`, clear selection.
  - tap the **same** slot → put down (cancel).
  - tap another **filled, non-eligible** slot → re-pick that player.
  - tap elsewhere / a non-eligible empty slot → cancel.
- A small caption ("Tap a player, then a green slot to move them") + a Cancel affordance
  while in move-mode, for discoverability.

### 3. Wire the three pages

Each replaces its read-only `<Pitch … />` with `<EditablePitch … onMove={…}/>`:
- **play** & **team** & **wc**: `onMove = (from, to) => { const next = movePlayer(team, from, to); saveTeam(next); setTeam(next); }`.

No other page logic changes. `play`'s existing "pick a spun player → choose slot" flow
is untouched and complementary.

## Testing

**Unit — `src/lib/draft/local.test.ts`** (added to `scripts/draft/run-tests.sh`; the
runner tolerates the `localStorage` type error since it only emits + runs the pure
tests):
- `movableSlots` returns only same-line slots, excludes the source slot, includes filled
  same-line slots, `[]` for an empty/invalid slot id.
- `movePlayer` into an empty slot relocates and updates `slotPos`; squad size unchanged.
- `movePlayer` into a filled slot swaps both players' slots; both retain their cards.
- A same-line swap is always legal both ways (invariant); illegal/cross-line `to` is a
  no-op returning the original team.
- `strength` recomputes (a relocation that changes a player's fit changes strength).
- Determinism: same inputs → same result.

**Types/build:** `npx tsc --noEmit` clean; `pnpm build` clean.

**Preview (mobile-first):** `/38-0` → seed a partial + full XI → on play, team, and wc:
tap a placed player, confirm only same-line slots glow, move to an empty slot (relocates)
and onto a filled slot (swaps), confirm OVERALL + line bars update and the change
persists across reload. Confirm cross-line slots never light up. No console errors.

`graphify update .` after code changes.

## Risks / notes

- **Discoverability:** placed players weren't tappable before. The caption + the glow on
  first tap teach the gesture; the `team` screen is the natural home for rearranging.
- **No new persistence surface:** reuses `saveTeam`; server schema unchanged. Downstream
  matches read `team.squad`, so they inherit the arrangement with zero match-engine work.
- **Same-line only** keeps the competitive/fit model intact — a cover position still
  carries its existing `fitMultiplier` penalty, so moving a striker to the wing is
  rated exactly as it would be if drafted there.
