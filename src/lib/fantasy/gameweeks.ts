/**
 * Gameweek state + the ONE replay/live gate. Everything else is mode-blind:
 * replay = edits open until the user explicitly locks; live = edits open until
 * the stored deadline (first kickoff − 90m). Same state machine either way.
 */
import "server-only";

export interface GwRow {
  gw: number;
  season: string;
  mode: "replay" | "live";
  window_start: string;
  window_end: string;
  deadline: string | null;
  status: "open" | "locked" | "scored" | "final";
  sm_season_id: number;
}

export interface EntryLockView { locked_at: string | null }

export function isOpenForEdits(gw: GwRow, entry: EntryLockView | null): boolean {
  if (gw.status !== "open") return false;
  if (gw.mode === "replay") return !entry?.locked_at;
  return gw.deadline !== null && Date.now() < new Date(gw.deadline).getTime();
}

/** When the LIVE round (the weekly quiz) unlocks: midnight UTC on the gameweek's
 *  first match day. Squad building is open all pre-deadline; the quiz is a
 *  gameday thing, so weeks-early plays can't appear before the gameweek exists.
 *  Replay is self-paced and has no lower bound. */
export function roundOpensAt(gw: GwRow): Date | null {
  if (gw.mode !== "live") return null;
  return new Date(`${gw.window_start.slice(0, 10)}T00:00:00Z`);
}

/** The round's own gate: everything isOpenForEdits enforces, plus a live round
 *  cannot begin before its gameday. */
export function isRoundOpen(gw: GwRow, entry: EntryLockView | null): boolean {
  if (!isOpenForEdits(gw, entry)) return false;
  const opens = roundOpensAt(gw);
  return opens === null || Date.now() >= opens.getTime();
}
