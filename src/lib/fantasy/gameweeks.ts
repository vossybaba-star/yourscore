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
