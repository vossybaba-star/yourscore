/**
 * Gameweek state + the ONE replay/live gate. Everything else is mode-blind:
 * replay = edits open until the user explicitly locks; live = edits open until
 * the stored deadline (first kickoff − 90m). Same state machine either way.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** The one LIVE gameweek — the season's, not any one user's. Shared between
 *  server.ts's per-user `currentGw` (which falls back to a per-user replay
 *  gameweek when no live row exists) and the fantasy-advice cron (which has no
 *  user at all and only ever cares about the live season). Pulled out here so
 *  both read the exact same "any live row wins, prefer the first non-final one"
 *  rule instead of two copies drifting apart. Returns null when there's no live
 *  gameweek at all (replay-only / pre-season) — the caller decides what that
 *  means for it. */
export async function currentLiveGw(db: Db): Promise<GwRow | null> {
  const { data: gws, error } = await db.from("fantasy_gameweeks")
    .select("*").order("gw", { ascending: true });
  if (error) throw new Error(error.message);
  const live = ((gws ?? []) as GwRow[]).filter((g) => g.mode === "live");
  if (!live.length) return null;
  return (live.find((g) => g.status !== "final") ?? live[live.length - 1]) as GwRow;
}
