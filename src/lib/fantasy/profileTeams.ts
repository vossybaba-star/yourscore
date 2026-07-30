/**
 * A player's fantasy squad for each gameweek — the data behind "see the teams
 * they've picked over the weeks" on a profile.
 *
 * Sources, newest first:
 *   - `fantasy_deadline_squad` — the immutable XI captured at each deadline (the
 *     honest record of what was actually taken into the gameweek).
 *   - `fantasy_squads` — the LIVE editable squad, shown as "this week" while the
 *     current gameweek hasn't locked yet. Founder's call (30 Jul): a submitted
 *     team is public immediately, so the live squad is included pre-deadline.
 *
 * `server-only`: reads other users' squads through the service client (the tables
 * are RLS own-row), and resolves faces off the baked pool — never client-reachable.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientPool } from "./pool";
import { pitchName, type BoardPlayer } from "./board";
import { faceFor } from "./faces";
import type { FantasyPos } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export interface WeeklyTeam {
  gw: number;
  /** Short chip label, e.g. "GW3". */
  label: string;
  /** The live, not-yet-locked team for the current gameweek. */
  current: boolean;
  xi: number[];
  bench: number[];
  captain: number | null;
  vice: number | null;
  /** Gameweek total once scored; null before then (and for the live team). */
  points: number | null;
}

export interface ProfileTeams {
  teams: WeeklyTeam[];        // newest gameweek first
  players: BoardPlayer[];     // every player referenced across the teams
}

/** The current live gameweek — the season is live, so it's the first live row
 *  that isn't final (mirrors server.ts currentGw's live branch). */
async function liveCurrentGw(db: Db): Promise<number | null> {
  const { data } = await db.from("fantasy_gameweeks")
    .select("gw, status, mode").eq("mode", "live").order("gw", { ascending: true });
  if (!data?.length) return null;
  const open = (data as { gw: number; status: string }[]).find((g) => g.status !== "final")
    ?? (data[data.length - 1] as { gw: number });
  return open.gw;
}

export async function loadProfileTeams(db: Db, userId: string): Promise<ProfileTeams> {
  const [{ data: snaps }, { data: live }, { data: entries }, curGw] = await Promise.all([
    db.from("fantasy_deadline_squad")
      .select("gameweek, xi, bench, captain, vice")
      .eq("user_id", userId).order("gameweek", { ascending: false }),
    db.from("fantasy_squads")
      .select("xi, bench, captain, vice").eq("user_id", userId).maybeSingle(),
    db.from("fantasy_entries")
      .select("gw, points").eq("user_id", userId),
    liveCurrentGw(db),
  ]);

  const pointsByGw = new Map<number, number | null>(
    ((entries ?? []) as { gw: number; points: number | null }[]).map((e) => [e.gw, e.points]),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams: WeeklyTeam[] = ((snaps ?? []) as any[]).map((s) => ({
    gw: s.gameweek, label: `GW${s.gameweek}`, current: false,
    xi: s.xi ?? [], bench: s.bench ?? [], captain: s.captain, vice: s.vice,
    points: pointsByGw.get(s.gameweek) ?? null,
  }));

  // The live squad = this week's team, shown only when the current gameweek isn't
  // already snapshotted (after the deadline the immutable snapshot is the truth).
  const haveCurrentSnap = curGw != null && teams.some((t) => t.gw === curGw);
  if (live && curGw != null && !haveCurrentSnap && ((live.xi as number[] | null)?.length ?? 0) > 0) {
    teams.unshift({
      gw: curGw, label: `GW${curGw}`, current: true,
      xi: (live.xi as number[]) ?? [], bench: (live.bench as number[]) ?? [],
      captain: live.captain as number | null, vice: live.vice as number | null,
      points: null,
    });
  }

  if (teams.length === 0) return { teams: [], players: [] };

  // Resolve every referenced player to a board marker. No price is attached —
  // this is a lineup record, not the shop, so markers stay clean (no £ tags).
  const ids = new Set<number>();
  for (const t of teams) { t.xi.forEach((i) => ids.add(i)); t.bench.forEach((i) => ids.add(i)); }
  const byId = new Map(clientPool().players.map((p) => [p.id, p]));
  const players: BoardPlayer[] = Array.from(ids).map((id) => {
    const p = byId.get(id);
    return {
      id,
      name: p?.name ?? `#${id}`,
      label: pitchName(p?.name ?? `#${id}`),
      pos: (p?.pos ?? "MID") as FantasyPos,
      club: p?.club,
      avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined,
    };
  });

  return { teams, players };
}
