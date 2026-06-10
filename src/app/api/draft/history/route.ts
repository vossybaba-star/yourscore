import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/draft/history
 *
 * Returns the authenticated user's complete H2H 38-0 match history, combining:
 *   - draft_matches       (quick async challenges: find → resolve)
 *   - draft_live_matches  (real-time 2-half live matches)
 *
 * Response shape:
 * {
 *   matches: HistoryEntry[];
 *   opponents: OpponentRecord[]; // unique opponents + record against each
 * }
 */

export interface HistoryEntry {
  id: string;
  type: "live" | "quick";
  opponentId: string | null;
  opponentName: string;
  myGoals: number;
  oppGoals: number;
  /** W / D / L from the authenticated user's perspective */
  outcome: "W" | "D" | "L";
  playedAt: string;
  myFormation?: string | null;
  oppFormation?: string | null;
  myStrength?: number | null;
  oppStrength?: number | null;
}

export interface OpponentRecord {
  opponentId: string;
  opponentName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  lastPlayedAt: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const uid = user.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // ── 1. draft_matches (quick H2H) ─────────────────────────────────────────
  const { data: quickRows } = await sb
    .from("draft_matches")
    .select("id, challenger_id, opponent_id, challenger_goals, opponent_goals, winner_id, played_at, challenger_team, opponent_team, challenger_strength, opponent_strength")
    .or(`challenger_id.eq.${uid},opponent_id.eq.${uid}`)
    .not("opponent_id", "is", null)
    .order("played_at", { ascending: false })
    .limit(200);

  // Collect all opponent IDs to resolve display names
  const quickOppIds: string[] = [];
  for (const r of (quickRows ?? [])) {
    const oppId = r.challenger_id === uid ? r.opponent_id : r.challenger_id;
    if (oppId) quickOppIds.push(oppId);
  }
  const nameMap: Record<string, string> = {};
  if (quickOppIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", Array.from(new Set(quickOppIds)));
    for (const p of (profiles ?? [])) nameMap[p.id] = p.display_name ?? "Player";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quickEntries: HistoryEntry[] = (quickRows ?? []).map((r: any) => {
    const iChallenger = r.challenger_id === uid;
    const oppId = iChallenger ? r.opponent_id : r.challenger_id;
    const myGoals = iChallenger ? (r.challenger_goals ?? 0) : (r.opponent_goals ?? 0);
    const oppGoals = iChallenger ? (r.opponent_goals ?? 0) : (r.challenger_goals ?? 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const myTeam = (iChallenger ? r.challenger_team : r.opponent_team) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oppTeam = (iChallenger ? r.opponent_team : r.challenger_team) as any;
    let outcome: "W" | "D" | "L" = "D";
    if (r.winner_id === uid) outcome = "W";
    else if (r.winner_id && r.winner_id !== uid) outcome = "L";
    return {
      id: r.id,
      type: "quick",
      opponentId: oppId ?? null,
      opponentName: oppId ? (nameMap[oppId] ?? "Player") : "Unknown",
      myGoals,
      oppGoals,
      outcome,
      playedAt: r.played_at ?? new Date(0).toISOString(),
      myFormation: myTeam?.formation ?? null,
      oppFormation: oppTeam?.formation ?? null,
      myStrength: iChallenger ? r.challenger_strength : r.opponent_strength,
      oppStrength: iChallenger ? r.opponent_strength : r.challenger_strength,
    };
  });

  // ── 2. draft_live_matches (real-time H2H) ────────────────────────────────
  const { data: liveRows } = await sb
    .from("draft_live_matches")
    .select("id, p1_id, p2_id, p1_name, p2_name, h1_p1, h1_p2, h2_p1, h2_p2, pens_p1, pens_p2, winner_id, resolved_at, is_bot, p1_formation, p2_formation, p1_strength, p2_strength")
    .or(`p1_id.eq.${uid},p2_id.eq.${uid}`)
    .eq("is_bot", false)
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(200);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveEntries: HistoryEntry[] = (liveRows ?? []).map((r: any) => {
    const iP1 = r.p1_id === uid;
    const oppId = iP1 ? r.p2_id : r.p1_id;
    const oppName = iP1 ? (r.p2_name ?? "Player") : (r.p1_name ?? "Player");
    const myGoals = (iP1 ? (r.h1_p1 ?? 0) + (r.h2_p1 ?? 0) : (r.h1_p2 ?? 0) + (r.h2_p2 ?? 0));
    const oppGoals = (iP1 ? (r.h1_p2 ?? 0) + (r.h2_p2 ?? 0) : (r.h1_p1 ?? 0) + (r.h2_p1 ?? 0));
    let outcome: "W" | "D" | "L" = "D";
    if (r.winner_id === uid) outcome = "W";
    else if (r.winner_id && r.winner_id !== uid) outcome = "L";
    return {
      id: r.id,
      type: "live",
      opponentId: oppId ?? null,
      opponentName: oppName,
      myGoals,
      oppGoals,
      outcome,
      playedAt: r.resolved_at,
      myFormation: iP1 ? r.p1_formation : r.p2_formation,
      oppFormation: iP1 ? r.p2_formation : r.p1_formation,
      myStrength: iP1 ? r.p1_strength : r.p2_strength,
      oppStrength: iP1 ? r.p2_strength : r.p1_strength,
    };
  });

  // ── 3. Merge and sort ────────────────────────────────────────────────────
  const allMatches = [...quickEntries, ...liveEntries].sort(
    (a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime()
  );

  // ── 4. Opponent records ───────────────────────────────────────────────────
  const oppMap = new Map<string, OpponentRecord>();
  for (const m of allMatches) {
    if (!m.opponentId) continue;
    let rec = oppMap.get(m.opponentId);
    if (!rec) {
      rec = { opponentId: m.opponentId, opponentName: m.opponentName, played: 0, wins: 0, draws: 0, losses: 0, lastPlayedAt: m.playedAt };
      oppMap.set(m.opponentId, rec);
    }
    rec.played++;
    if (m.outcome === "W") rec.wins++;
    else if (m.outcome === "D") rec.draws++;
    else rec.losses++;
    if (new Date(m.playedAt) > new Date(rec.lastPlayedAt)) rec.lastPlayedAt = m.playedAt;
  }
  const opponents = Array.from(oppMap.values()).sort(
    (a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime()
  );

  return NextResponse.json({ matches: allMatches, opponents });
}
