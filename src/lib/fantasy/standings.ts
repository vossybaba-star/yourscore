/**
 * Global fantasy standings — where a player falls among EVERYONE, not just their
 * private leagues. Three scopes over the same ranking RPC:
 *   - month  (the headline monthly comp; the hero view) → the current month's gws
 *   - season (cumulative) → every gameweek
 *   - gw     (this week) → the latest scored gameweek
 *
 * The RPC (mig 224) does the aggregation and returns the top N plus the viewer's
 * own row; this resolves names/faces and labels the scope. `server-only`: reads
 * profiles + calls a service-role RPC.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyOf, monthLabel, groupGwsByMonth } from "./months";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type StandingsScope = "month" | "season" | "gw";

export interface StandingRow {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  played: number;
  isMe: boolean;
}

export interface GlobalStandings {
  scope: StandingsScope;
  /** Human label for the scope — a month NAME ("August"), "Season", or "Gameweek 3". */
  title: string;
  rows: StandingRow[];          // the top N
  you: StandingRow | null;      // the viewer's row (may rank beyond the top N)
  totalPlayers: number;
}

interface GwRow { gw: number; window_end: string; status: string }

/** The live season's gameweeks + the current one (first not-final). */
async function seasonGws(db: Db): Promise<{ gws: GwRow[]; current: GwRow } | null> {
  const { data } = await db.from("fantasy_gameweeks")
    .select("gw, window_end, status, mode").eq("mode", "live").order("gw", { ascending: true });
  const gws = (data ?? []) as GwRow[];
  if (!gws.length) return null;
  const current = gws.find((g) => g.status !== "final") ?? gws[gws.length - 1];
  return { gws, current };
}

const monthName = (key: string) => monthLabel(key).replace(/\s+\d{4}$/, "");

export async function loadGlobalStandings(
  db: Db, viewerId: string | null, scope: StandingsScope, limit = 50,
): Promise<GlobalStandings> {
  const season = await seasonGws(db);
  if (!season) return { scope, title: scope === "season" ? "Season" : "This week", rows: [], you: null, totalPlayers: 0 };
  const { gws, current } = season;

  let targetGws: number[];
  let title: string;
  if (scope === "season") {
    targetGws = gws.map((g) => g.gw);
    title = "Season";
  } else if (scope === "gw") {
    // The most recent gameweek that has actually scored — a live/final row —
    // else the current one (empty until it scores).
    const scored = [...gws].reverse().find((g) => g.status === "final" || g.status === "scored");
    const g = scored ?? current;
    targetGws = [g.gw];
    title = `Gameweek ${g.gw}`;
  } else {
    const key = monthKeyOf(current);
    targetGws = groupGwsByMonth(gws).get(key) ?? [current.gw];
    title = monthName(key);
  }

  const { data } = await db.rpc("fantasy_global_standings", {
    p_gws: targetGws, p_viewer: viewerId, p_limit: limit,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (data ?? []) as any[];
  if (!raw.length) return { scope, title, rows: [], you: null, totalPlayers: 0 };

  const ids = raw.map((r) => r.user_id as string);
  const profById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  const { data: profs } = await db.from("profiles").select("id, display_name, avatar_url").in("id", ids);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toRow = (r: any): StandingRow => ({
    rank: Number(r.rank), userId: r.user_id,
    name: profById.get(r.user_id)?.display_name ?? "Player",
    avatarUrl: profById.get(r.user_id)?.avatar_url ?? null,
    points: Number(r.points), played: Number(r.played), isMe: !!r.is_viewer,
  });

  const all = raw.map(toRow);
  const rows = all.filter((r) => r.rank <= limit);
  const you = all.find((r) => r.isMe) ?? null;
  const totalPlayers = Number(raw[0].total_players ?? all.length);
  return { scope, title, rows, you, totalPlayers };
}
