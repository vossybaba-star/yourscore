/**
 * Draft XI — rearranging a placed squad (pure, no persistence, no player DB).
 *
 * Lets a user move a player they've already placed to another position they can
 * play. Eligibility is same-line only (`canPlay`, category-based) — the existing fit
 * model is untouched. Kept dependency-light (formations + score + types) so it stays
 * unit-testable without dragging the player-season JSON into the test harness; the
 * `LocalTeam`-facing wrappers live in `local.ts`.
 */

import { slotsFor } from "./formations";
import { canPlay } from "./score";
import type { Formation, PlacedPlayer, Slot } from "./types";

/** Slots a placed player can move into — every slot in their own line (`canPlay`)
 *  except the one they currently occupy. Filled or empty; a filled target means a
 *  swap. Empty array if `slotId` holds no player. */
export function movableSlots(formation: Formation, squad: PlacedPlayer[], slotId: string): Slot[] {
  const player = squad.find((p) => p.slot === slotId);
  if (!player) return [];
  return slotsFor(formation).filter((s) => s.id !== slotId && canPlay(player.position, s.pos));
}

/**
 * Move the player in `fromSlotId` to `toSlotId`, returning the new squad — or `null`
 * when the move is a no-op (no player to move, from===to, unknown slot, or not a
 * same-line legal destination). Empty target ⇒ relocate; filled target ⇒ swap.
 *
 * Because eligibility is category-based, a same-line swap is always legal both ways;
 * we still refuse a swap that would strand the displaced player out of line as a
 * defensive guard.
 */
export function rearrange(
  formation: Formation,
  squad: PlacedPlayer[],
  fromSlotId: string,
  toSlotId: string,
): PlacedPlayer[] | null {
  if (fromSlotId === toSlotId) return null;
  const mover = squad.find((p) => p.slot === fromSlotId);
  if (!mover) return null;
  const slots = slotsFor(formation);
  const fromSlot = slots.find((s) => s.id === fromSlotId);
  const toSlot = slots.find((s) => s.id === toSlotId);
  if (!fromSlot || !toSlot) return null;
  if (!canPlay(mover.position, toSlot.pos)) return null; // not same-line — illegal

  const displaced = squad.find((p) => p.slot === toSlotId);
  if (displaced && !canPlay(displaced.position, fromSlot.pos)) return null; // can't happen same-line; guard

  return squad.map((p) => {
    if (p.slot === fromSlotId) return { ...p, slot: toSlot.id, slotPos: toSlot.pos };
    if (displaced && p.slot === toSlotId) return { ...p, slot: fromSlot.id, slotPos: fromSlot.pos };
    return p;
  });
}
