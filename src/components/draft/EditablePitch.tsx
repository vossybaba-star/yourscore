"use client";

/**
 * Draft XI — rearrangeable pitch. Wraps the read-only <Pitch> with a tap-to-move
 * interaction so a user can switch a placed player to another position they can play
 * (same-line). Tap a player to pick them up → their eligible slots light up → tap one
 * to move (swap if it's filled). Tap them again, or anywhere off-target, to cancel.
 *
 * Stateless about persistence: it just calls `onMove(fromSlotId, toSlotId)` and lets
 * the page apply `movePlayer` + `saveTeam`. The squad it renders is the source of truth.
 */

import { useState } from "react";
import { Pitch } from "./Pitch";
import { movableSlots } from "@/lib/draft/rearrange";
import type { Formation, PlacedPlayer } from "@/lib/draft/types";

export function EditablePitch({
  formation,
  squad,
  compact,
  hideOverall,
  onMove,
}: {
  formation: Formation;
  squad: PlacedPlayer[];
  compact?: boolean;
  hideOverall?: boolean;
  onMove: (fromSlotId: string, toSlotId: string) => void;
}) {
  const [movingFrom, setMovingFrom] = useState<string | null>(null);

  // While a player is picked up, the slots they can legally move into.
  const eligible = movingFrom
    ? new Set(movableSlots(formation, squad, movingFrom).map((s) => s.id))
    : undefined;

  const filled = new Set(squad.map((p) => p.slot));
  const mover = movingFrom ? squad.find((p) => p.slot === movingFrom) : null;

  function handleSlot(slotId: string) {
    if (!movingFrom) {
      // Pick up a player (empty slots aren't draggable sources).
      if (filled.has(slotId)) setMovingFrom(slotId);
      return;
    }
    if (slotId === movingFrom) {
      setMovingFrom(null); // put down
      return;
    }
    if (eligible?.has(slotId)) {
      onMove(movingFrom, slotId);
      setMovingFrom(null);
      return;
    }
    // Tapped a non-target: re-pick if it's another player, else cancel.
    setMovingFrom(filled.has(slotId) ? slotId : null);
  }

  return (
    <div className="relative">
      <Pitch
        formation={formation}
        squad={squad}
        compact={compact}
        hideOverall={hideOverall}
        onSlotClick={handleSlot}
        eligibleSlots={eligible}
        selectedSlot={movingFrom}
      />
      {/* coaching caption — teaches the gesture, offers a clear way out */}
      <div className="mt-2 flex items-center justify-center gap-3 min-h-[20px]">
        {mover ? (
          <>
            <span className="font-body" style={{ fontSize: 12, color: "#00ff87" }}>
              Move <b>{mover.name.split(" ").slice(-1)[0]}</b> → tap a green slot
            </span>
            <button
              onClick={() => setMovingFrom(null)}
              className="font-body"
              style={{ fontSize: 12, color: "#8888aa" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <span className="font-body" style={{ fontSize: 11, color: "#666" }}>
            Tap a player to switch their position
          </span>
        )}
      </div>
    </div>
  );
}
