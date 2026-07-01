"use client";

/**
 * Draft XI — pitch view. Renders the 11 formation slots at their x/y coordinates,
 * showing filled players (name, overall, club/season, fit colour) or empty
 * targets. Used on the draft loop, team screen, and H2H result.
 */

import type { Formation, PlacedPlayer } from "@/lib/draft/types";
import { slotsFor } from "@/lib/draft/formations";
import { fitMultiplier, FIT_EXACT, FIT_SAME } from "@/lib/draft/score";

function fitColor(player: PlacedPlayer): string {
  const f = fitMultiplier(player.position, player.slotPos);
  if (f >= FIT_EXACT) return "#aeea00";   // natural position
  if (f >= FIT_SAME) return "#ffb800";    // same-line cover (legal)
  return "#ff4757";                       // out of line (shouldn't occur)
}

export function Pitch({
  formation,
  squad,
  highlightSlot,
  onSlotClick,
  compact,
  hideOverall,
  noLabels,
}: {
  formation: Formation;
  squad: PlacedPlayer[];
  highlightSlot?: string | null;
  onSlotClick?: (slotId: string) => void;
  compact?: boolean;
  /** Expert mode: show the player's position in the token instead of the rating. */
  hideOverall?: boolean;
  /** Tokens only — hide the name/position labels under each token (for small hero pitches). */
  noLabels?: boolean;
}) {
  const slots = slotsFor(formation);
  const bySlot = new Map(squad.map((p) => [p.slot, p]));

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl"
      style={{
        aspectRatio: compact ? "3 / 4" : "10 / 14",
        background:
          "linear-gradient(0deg, #0c2a17 0%, #0f3a1f 55%, #0c2a17 100%)",
        border: "1px solid rgba(174,234,0,0.18)",
      }}
    >
      {/* pitch markings */}
      <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.5 }}>
        <div className="absolute left-0 right-0" style={{ top: "50%", height: 1, background: "rgba(255,255,255,0.18)" }} />
        <div className="absolute rounded-full" style={{ left: "50%", top: "50%", width: "26%", paddingBottom: "26%", transform: "translate(-50%,-50%)", border: "1px solid rgba(255,255,255,0.18)" }} />
        <div className="absolute" style={{ left: "25%", right: "25%", top: 0, height: "12%", border: "1px solid rgba(255,255,255,0.18)", borderTop: "none" }} />
        <div className="absolute" style={{ left: "25%", right: "25%", bottom: 0, height: "12%", border: "1px solid rgba(255,255,255,0.18)", borderBottom: "none" }} />
      </div>

      {slots.map((s) => {
        const p = bySlot.get(s.id);
        const highlighted = highlightSlot === s.id;
        return (
          <button
            key={s.id}
            onClick={onSlotClick ? () => onSlotClick(s.id) : undefined}
            disabled={!onSlotClick}
            className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2 transition-transform active:scale-95"
            style={{
              left: `${s.x}%`,
              top: `${100 - s.y}%`,
              width: compact ? 48 : 60,
              cursor: onSlotClick ? "pointer" : "default",
            }}
          >
            {p ? (
              <>
                <div
                  className="flex items-center justify-center rounded-full font-display"
                  style={{
                    width: compact ? 28 : 36,
                    height: compact ? 28 : 36,
                    fontSize: hideOverall ? (compact ? 10 : 12) : (compact ? 13 : 17),
                    background: "rgba(10,10,15,0.85)",
                    border: `2px solid ${fitColor(p)}`,
                    color: fitColor(p),
                    boxShadow: highlighted ? `0 0 14px ${fitColor(p)}` : "none",
                  }}
                >
                  {hideOverall ? p.position : p.overall}
                </div>
                {!noLabels && (
                  <div
                    className="mt-1 px-1 rounded text-center leading-tight font-body"
                    style={{
                      fontSize: compact ? 8 : 9,
                      color: "#fff",
                      background: "rgba(10,10,15,0.7)",
                      maxWidth: compact ? 48 : 60,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.name.split(" ").slice(-1)[0]}
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="flex items-center justify-center rounded-full font-display"
                  style={{
                    width: compact ? 28 : 36,
                    height: compact ? 28 : 36,
                    fontSize: compact ? 10 : 12,
                    background: highlighted ? "rgba(174,234,0,0.18)" : "rgba(255,255,255,0.06)",
                    border: `2px dashed ${highlighted ? "#aeea00" : "rgba(255,255,255,0.3)"}`,
                    color: highlighted ? "#aeea00" : "#8a948f",
                  }}
                >
                  {s.label}
                </div>
                <div className="mt-1 font-body" style={{ fontSize: compact ? 8 : 9, color: "#8a948f" }}>
                  empty
                </div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
