/**
 * SquadBoard logic — pure, no React, no I/O. The single source of truth for how
 * a squad becomes a tactical board across every Fantasy surface (build, complete,
 * plan, transfer, live, final). Keeping the layout maths here means the board
 * component never branches on mode at render time, and the rules stay testable.
 */
import { SQUAD_QUOTA, type FantasyPos } from "./engine";

export type BoardMode = "build" | "complete" | "plan" | "transfer" | "live" | "final";

/** A player's live/final standing, driving the marker's datum and dim state. */
export type PlayerState = "live" | "done" | "tocome";
export interface LiveDatum {
  points: number;
  /** Match minute while `state === "live"`; null otherwise. */
  minute?: number | null;
  state: PlayerState;
}

/** The minimum a board needs to draw one player. The caller maps the pool/squad
 *  onto this shape once, so the board is decoupled from the pool's exact type. */
export interface BoardPlayer {
  id: number;
  name: string;
  /** One-word pitch label (a surname, usually) — use `pitchName`. */
  label: string;
  pos: FantasyPos;
  club?: string;
  avatarUrl?: string | null;
  price?: number;
}

// Attacking the top of the screen: forwards nearest the opposition goal, keeper
// at the back. Matches the pitch the hub has always drawn.
const ATTACK_ORDER: FantasyPos[] = ["FWD", "MID", "DEF", "GK"];

/** One word for the pitch: the surname, keeping "van Dijk" / "de Bruyne" style
 *  particles so the name doesn't read wrong alone. The full name is used
 *  everywhere it fits (menus, tables, compare). */
export function pitchName(full: string): string {
  const parts = full.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^(de|van|von|da|dos|del|di|el|al|mc|le)$/i.test(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}

/** The starting XI grouped into formation rows, top-down FWD→GK. Empty rows are
 *  dropped so a lopsided formation doesn't leave a blank band. */
export function xiRows(
  xi: number[],
  posOf: Map<number, FantasyPos>,
): { pos: FantasyPos; ids: number[] }[] {
  return ATTACK_ORDER
    .map((pos) => ({ pos, ids: xi.filter((id) => posOf.get(id) === pos) }))
    .filter((r) => r.ids.length > 0);
}

/** Build mode: the fifteen slots laid out by position, filled players first and
 *  the rest empty placeholders up to the quota — so the board shows the SHAPE of
 *  the squad from the very first pick and never a blank pitch. */
export function rosterBands(
  players: BoardPlayer[],
): { pos: FantasyPos; filled: BoardPlayer[]; empty: number }[] {
  return ATTACK_ORDER.map((pos) => {
    const filled = players.filter((p) => p.pos === pos);
    return { pos, filled, empty: Math.max(0, SQUAD_QUOTA[pos] - filled.length) };
  });
}

/** The one datum shown under a marker, decided by mode. A pure string so the
 *  board renders it blindly. Price in planning modes; points (and the live
 *  minute) once a gameweek is scoring. */
export function datumFor(mode: BoardMode, p: BoardPlayer, live?: LiveDatum): string | undefined {
  if ((mode === "live" || mode === "final") && live) {
    if (mode === "live" && live.state === "tocome") return "to play";
    if (mode === "live" && live.state === "live" && live.minute != null) return `${live.points} · ${live.minute}'`;
    return `${live.points} pt${live.points === 1 ? "" : "s"}`;
  }
  if (p.price != null) return `£${p.price.toFixed(1)}`;
  return undefined;
}

/** A marker dims when it's off the action: on the bench, or (live) yet to play /
 *  featured-but-blank. Keeps the eye on what's happening now. */
export function isDim(mode: BoardMode, onBench: boolean, live?: LiveDatum): boolean {
  if (mode === "live" && live) return live.state !== "live";
  return onBench;
}

/** Best and worst scorers of a gameweek — REAL, straight off the point
 *  breakdown (captain points already doubled). Null on an empty week. */
export function bestWorst<T extends { id: number; points: number }>(
  rows: T[],
): { best: T | null; worst: T | null } {
  if (!rows.length) return { best: null, worst: null };
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}
