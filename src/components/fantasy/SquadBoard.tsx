"use client";

import type { CSSProperties, ReactNode } from "react";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { LINE, MUTED, TEAL } from "@/components/fantasy/shared";
import {
  xiRows, rosterBands, datumFor, isDim,
  type BoardMode, type BoardPlayer, type LiveDatum,
} from "@/lib/fantasy/board";
import type { FantasyPos } from "@/lib/fantasy/engine";

/**
 * THE Squad Board — one tactical pitch reused across every Fantasy surface.
 * Presentational: the caller owns the data and the interactions, the board owns
 * the layout. `mode` decides the datum (price vs points) and the dim states via
 * the pure helpers in lib/fantasy/board.ts, so this component never reasons
 * about game rules.
 *
 * Two layouts:
 *  - build  → the fifteen slots by position with empty placeholders (no dugout);
 *             the squad's SHAPE from the first pick.
 *  - others → the XI in formation rows + the four subs in the dugout.
 */
export interface SquadBoardProps {
  mode: BoardMode;
  /** Every squad player the board can draw (up to 15). */
  players: BoardPlayer[];
  xi?: number[];
  bench?: number[];
  captain?: number;
  vice?: number;
  /** id → doubt reason (draws the amber dot). */
  doubts?: Record<number, string>;
  /** id → live/final standing (points, minute, state). */
  live?: Record<number, LiveDatum>;
  /** transfer mode: the player being moved out, ringed for focus. */
  selectedId?: number | null;
  /** Tap a player (both pitch and bench). */
  onSlot?: (id: number, ctx: { onBench: boolean }) => void;
  /** Tap an empty build slot for a position. */
  onEmpty?: (pos: FantasyPos) => void;
  /** The player whose menu is open (the caller owns this state). */
  menuFor?: number | null;
  /** Render a menu anchored under a player — the caller owns its content and
   *  actions (captain/vice/swap); the board only positions it. */
  renderMenu?: (id: number, ctx: { onBench: boolean }) => ReactNode;
}

const sizeForRow = (n: number, onBench: boolean) =>
  onBench ? 26 : n >= 5 ? 26 : n === 4 ? 30 : 34;

export function SquadBoard(props: SquadBoardProps) {
  const { mode, players, doubts = {}, live = {}, selectedId, onSlot, onEmpty, menuFor, renderMenu } = props;
  const byId = new Map(players.map((p) => [p.id, p]));
  const posOf = new Map<number, FantasyPos>(players.map((p) => [p.id, p.pos]));

  const Marker = ({ id, onBench, crowd, flipUp }: { id: number; onBench: boolean; crowd: number; flipUp?: boolean }) => {
    const p = byId.get(id);
    const selected = selectedId === id;
    const ld = live[id];
    const tappable = !!onSlot;
    const inner = (
      <PlayerMarker
        name={p?.name ?? `#${id}`}
        label={p?.label ?? `#${id}`}
        avatarUrl={p?.avatarUrl}
        size={sizeForRow(crowd, onBench)}
        isCaptain={props.captain === id}
        isVice={props.vice === id}
        doubt={doubts[id]}
        datum={p ? datumFor(mode, p, ld) : undefined}
        dim={isDim(mode, onBench, ld)}
      />
    );
    const controlStyle: CSSProperties = {
      background: "transparent", border: "none", padding: onBench ? "2px 0" : "2px 1px",
      width: "100%", cursor: tappable ? "pointer" : "default", borderRadius: 12,
      outline: selected ? `2px solid ${TEAL}` : undefined, outlineOffset: selected ? 1 : undefined,
    };
    const label = p
      ? [p.name, onBench ? "substitute" : p.pos, p.club, props.captain === id ? "captain" : props.vice === id ? "vice captain" : null, doubts[id] ? "a doubt to play" : null]
          .filter(Boolean).join(", ")
      : undefined;
    const control = tappable
      ? <button onClick={() => onSlot!(id, { onBench })} aria-label={label} aria-expanded={menuFor === id} aria-pressed={selected} style={controlStyle}>{inner}</button>
      : <div aria-label={label} style={controlStyle}>{inner}</div>;
    // A relative wrapper carries the row's flex sizing so the optional menu can
    // anchor to this player without disturbing the layout.
    const outer: CSSProperties = onBench
      ? { position: "relative", width: "100%" }
      : { position: "relative", flex: "1 1 0", maxWidth: 66, minWidth: 0 };
    return (
      <div style={outer}>
        {control}
        {renderMenu && menuFor === id && (
          // Bottom-row / low-bench players open the menu UPWARD so a tall menu
          // doesn't run off the bottom of the screen; everyone else opens down.
          <div style={{ position: "absolute", zIndex: 5, ...(flipUp ? { bottom: "105%" } : { top: "105%" }), ...(onBench ? { right: 0 } : { left: 0 }) }}>
            {renderMenu(id, { onBench })}
          </div>
        )}
      </div>
    );
  };

  const EmptySlot = ({ pos, size = 34 }: { pos: FantasyPos; size?: number }) => {
    const inner = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%", minWidth: 0 }}>
        <div aria-hidden style={{
          width: size, height: size, borderRadius: "50%",
          border: `1.5px dashed ${TEAL}`, opacity: 0.55,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: TEAL, fontSize: size * 0.5, lineHeight: 1, fontWeight: 300,
        }}>+</div>
        <span style={{ fontSize: 9.5, color: MUTED, fontWeight: 600, letterSpacing: "0.03em" }}>{pos}</span>
      </div>
    );
    const wrap: CSSProperties = {
      background: "transparent", border: "none", padding: "2px 1px",
      flex: "1 1 0", maxWidth: 66, minWidth: 0, cursor: onEmpty ? "pointer" : "default",
    };
    return onEmpty
      ? <button onClick={() => onEmpty(pos)} aria-label={`Add a ${pos}`} style={wrap}>{inner}</button>
      : <div style={wrap}>{inner}</div>;
  };

  // ── BUILD: position bands, filled first then empty slots, no dugout ─────────
  if (mode === "build") {
    const bands = rosterBands(players);
    return (
      <div className="rounded-2xl relative overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
        <PitchSurface>
          {bands.map((band) => {
            const n = band.filled.length + band.empty;
            return (
              <div key={band.pos} style={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "nowrap" }}>
                {band.filled.map((p) => <Marker key={p.id} id={p.id} onBench={false} crowd={n} />)}
                {Array.from({ length: band.empty }, (_, i) => (
                  <EmptySlot key={`e-${band.pos}-${i}`} pos={band.pos} size={sizeForRow(n, false)} />
                ))}
              </div>
            );
          })}
        </PitchSurface>
      </div>
    );
  }

  // ── XI modes: formation rows + dugout ──────────────────────────────────────
  const xi = props.xi ?? [];
  const bench = props.bench ?? [];
  const rows = xiRows(xi, posOf);
  return (
    // No `overflow-hidden` here: the art and dugout round their own outer corners
    // (below), so an open player menu can spill past the pitch edge instead of
    // being clipped mid-list. Corners are rounded per-part to keep the seam square.
    <div className="rounded-2xl relative" style={{ border: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <PitchSurface round={bench.length > 0 ? "left" : "all"}>
          {rows.map((row, ri) => (
            <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "nowrap" }}>
              {/* The bottom half of the pitch (defence + keeper) opens its menu
                  upward — a downward menu there runs off the bottom of the card. */}
              {row.ids.map((id) => <Marker key={id} id={id} onBench={false} crowd={row.ids.length} flipUp={ri >= rows.length - 2} />)}
            </div>
          ))}
        </PitchSurface>
        {bench.length > 0 && (
          <BenchStrip>
            {/* Lower dugout slots open upward for the same reason. */}
            {bench.map((id, bi) => <Marker key={id} id={id} onBench crowd={1} flipUp={bi >= bench.length - 2} />)}
          </BenchStrip>
        )}
      </div>
    </div>
  );
}
