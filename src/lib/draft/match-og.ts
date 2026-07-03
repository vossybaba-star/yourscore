import type { Metadata } from "next";
import { createDraftDb, type TeamSnapshot } from "@/lib/draft/server";
import { liveOgQuery } from "@/lib/draft/share";
import { asLeague, LEAGUE_META } from "@/lib/draft/types";
import type { MatchReport } from "@/lib/draft/live-score";

// Builds the OpenGraph metadata for a 38-0 head-to-head match. Used by the match
// page AND by the /s/<id> short link (whose payload can carry a matchId) so a
// shared H2H link always unfurls the MATCH card — never the season card.

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yourscore.app";

type MatchDetail = { pens?: { a: number; b: number } | null; report?: MatchReport; single?: boolean };
type Match = {
  challenger_team: TeamSnapshot;
  opponent_team: TeamSnapshot;
  challenger_strength: number;
  opponent_strength: number;
  challenger_id: string | null;
  winner_id: string | null;
  challenger_goals: number | null;
  opponent_goals: number | null;
  competition?: string;
  detail: MatchDetail | null;
};

async function getMatch(id: string): Promise<Match | null> {
  try {
    const db = createDraftDb();
    const { data, error } = await db
      .from("draft_matches")
      .select("challenger_team, opponent_team, challenger_strength, opponent_strength, challenger_id, winner_id, challenger_goals, opponent_goals, competition, detail")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      challenger_team: data.challenger_team as unknown as TeamSnapshot,
      opponent_team: data.opponent_team as unknown as TeamSnapshot,
      challenger_strength: Number(data.challenger_strength),
      opponent_strength: Number(data.opponent_strength),
      challenger_id: data.challenger_id,
      winner_id: data.winner_id,
      challenger_goals: data.challenger_goals,
      opponent_goals: data.opponent_goals,
      competition: (data as { competition?: string }).competition,
      detail: (data.detail ?? null) as MatchDetail | null,
    };
  } catch {
    return null;
  }
}

export async function matchOgMetadata(id: string): Promise<Metadata | null> {
  const m = await getMatch(id);
  if (!m) return null;
  const live = !!(m.detail && m.detail.report);
  const leagueName = LEAGUE_META[asLeague(m.competition)].name;

  let image: string, title: string, description: string;
  if (live) {
    const s1 = m.challenger_goals ?? 0, s2 = m.opponent_goals ?? 0;
    image = `${BASE}/api/draft/live-og?${liveOgQuery({
      p1: m.challenger_team.name, p2: m.opponent_team.name, s1, s2,
      str1: m.challenger_strength, str2: m.opponent_strength,
      pens: m.detail!.pens ?? null, report: m.detail!.report!,
    })}`;
    const pens = m.detail?.pens ? ` (pens ${m.detail.pens.a}-${m.detail.pens.b})` : "";
    title = `${m.challenger_team.name} ${s1}–${s2} ${m.opponent_team.name}${pens} — ${m.detail?.single ? "Draft XI" : "38-0 Live"}`;
    description = m.detail!.report!.potm
      ? `MOTM ${m.detail!.report!.potm.name} (${m.detail!.report!.potm.rating.toFixed(1)}). Build your XI and go live, head-to-head.`
      : `Build your all-time ${leagueName} XI and go live, head-to-head.`;
  } else {
    const challengerWon = m.winner_id === m.challenger_id;
    const og = new URLSearchParams({
      result: challengerWon ? "win" : "loss",
      tier: m.challenger_team.projected?.tier ?? "Champions",
      formation: m.challenger_team.formation,
      you: m.challenger_team.name, youStr: String(m.challenger_strength),
      opp: m.opponent_team.name, oppStr: String(m.opponent_strength),
    });
    image = `${BASE}/api/draft/og?${og.toString()}`;
    title = `${m.challenger_team.name} ${challengerWon ? "beat" : "lost to"} ${m.opponent_team.name} — Draft XI`;
    description = `${m.challenger_strength} vs ${m.opponent_strength}. Build your all-time ${leagueName} XI and take them on.`;
  }

  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
